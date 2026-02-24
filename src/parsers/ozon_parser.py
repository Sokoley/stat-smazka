#!/usr/bin/env python3
"""
Ozon Price Parser with Residential Proxy Support
Usage: python ozon_parser.py <sku1> <sku2> ... [--proxy URL] [--rotate-url URL]
"""

import sys
import json
import time
import random
import re
import requests
from bs4 import BeautifulSoup
from urllib.parse import quote
import argparse

# Default proxy settings
DEFAULT_PROXY = {
    'host': '93.190.143.48',
    'port': '443',
    'username': 'lhzoconcwq-res-country-RU-state-536203-city-498817-hold-session-session-699da825d2302',
    'password': 'a5XdSzQrTeDe0nmL',
    'rotate_url': 'https://api.sx.org/proxy/1956b819-1185-11f1-bf50-bc24114c89e8/refresh-ip'
}

# Headers to mimic real browser
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'max-age=0',
    'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'Connection': 'keep-alive',
}


class OzonParser:
    def __init__(self, proxy_config=None):
        self.proxy_config = proxy_config or DEFAULT_PROXY
        self.session = requests.Session()
        self.session.headers.update(HEADERS)
        self._setup_proxy()
        self.last_rotation = 0
        self.rotation_cooldown = 45  # seconds (reduced to recover faster from blocks)
        self.consecutive_blocks = 0
        self.post_rotation_pause = 12  # seconds to wait after rotation before next request

    def _setup_proxy(self):
        """Setup proxy for requests session"""
        proxy_url = f"http://{self.proxy_config['username']}:{self.proxy_config['password']}@{self.proxy_config['host']}:{self.proxy_config['port']}"
        self.session.proxies = {
            'http': proxy_url,
            'https': proxy_url
        }

    def rotate_ip(self, force=False, wait_if_cooldown=True):
        """Rotate proxy IP. If on cooldown and wait_if_cooldown=True, wait then rotate."""
        now = time.time()
        elapsed = now - self.last_rotation
        if not force and elapsed < self.rotation_cooldown:
            remaining = int(self.rotation_cooldown - elapsed)
            if wait_if_cooldown and self.consecutive_blocks >= 3:
                print(f"[COOLDOWN] Waiting {remaining}s before rotation (bad IP)...", file=sys.stderr)
                time.sleep(remaining)
                force = True
            else:
                print(f"[COOLDOWN] IP rotation on cooldown, {remaining}s left", file=sys.stderr)
                return False

        try:
            response = requests.get(self.proxy_config.get('rotate_url', DEFAULT_PROXY['rotate_url']), timeout=10)
            if response.status_code == 200:
                self.last_rotation = time.time()
                self.consecutive_blocks = 0
                print(f"[ROTATE] IP rotated successfully: {response.text}", file=sys.stderr)
                return True
            elif response.status_code == 429:
                print(f"[ROTATE] Too many requests, waiting...", file=sys.stderr)
                return False
            else:
                print(f"[ROTATE] Failed: {response.status_code} - {response.text}", file=sys.stderr)
                return False
        except Exception as e:
            print(f"[ROTATE] Error: {e}", file=sys.stderr)
            return False

    def check_proxy(self):
        """Check if proxy works on Ozon"""
        try:
            response = self.session.get('https://www.ozon.ru', timeout=30)
            content = response.text

            if 'Доступ ограничен' in content or 'не бот' in content or 'captcha' in content.lower():
                print("[CHECK] Proxy blocked on Ozon", file=sys.stderr)
                return False

            print("[CHECK] Proxy working", file=sys.stderr)
            return True
        except Exception as e:
            print(f"[CHECK] Error: {e}", file=sys.stderr)
            return False

    def _is_blocked(self, content):
        """Check if response indicates blocking"""
        blocked_indicators = [
            'Доступ ограничен',
            'не бот',
            'Подтвердите, что вы не робот',
            'captcha',
            'robot'
        ]
        content_lower = content.lower()
        return any(ind.lower() in content_lower for ind in blocked_indicators)

    def _extract_price_from_html(self, html, sku):
        """Extract price from Ozon product page HTML"""
        soup = BeautifulSoup(html, 'html.parser')

        # Method 1: Find price widget
        price_widget = soup.find(attrs={'data-widget': 'webPrice'})
        if price_widget:
            # Look for price with ruble sign
            for span in price_widget.find_all('span'):
                text = span.get_text()
                if '₽' in text and re.search(r'\d', text):
                    price_match = re.search(r'[\d\s]+₽', text)
                    if price_match:
                        return price_match.group().strip()

        # Method 2: JSON-LD data
        for script in soup.find_all('script', type='application/ld+json'):
            try:
                data = json.loads(script.string)
                if isinstance(data, dict) and 'offers' in data:
                    if 'price' in data['offers']:
                        return f"{data['offers']['price']} ₽"
            except:
                pass

        # Method 3: Search for card price in text
        text = soup.get_text()
        card_price_match = re.search(r'с Ozon Картой[\s\S]*?([\d\s]+\s*₽)', text, re.IGNORECASE)
        if card_price_match:
            return card_price_match.group(1).strip()

        # Method 4: Any price on page
        price_patterns = [
            r'(\d[\d\s]*₽)',
            r'price["\s:]+(\d+)',
        ]
        for pattern in price_patterns:
            match = re.search(pattern, html)
            if match:
                price = match.group(1)
                if '₽' not in price:
                    price += ' ₽'
                return price.strip()

        return None

    def _extract_price_from_api(self, json_text, sku):
        """Extract cardPrice from Ozon API response"""
        # Try regex patterns
        patterns = [
            r'"cardPrice"\s*:\s*"([^"]+)"',
            r'"ozonCardPrice"\s*:\s*"([^"]+)"',
            r'cardPrice["\s:]+([^",}]+)',
        ]

        for pattern in patterns:
            match = re.search(pattern, json_text)
            if match:
                price = match.group(1).strip()
                if '₽' in price and re.search(r'\d', price):
                    return price

        # Try parsing as JSON
        try:
            data = json.loads(json_text)
            return self._find_card_price(data)
        except:
            pass

        return None

    def _find_card_price(self, obj, depth=0):
        """Recursively find cardPrice in object"""
        if depth > 5 or obj is None:
            return None

        if isinstance(obj, dict):
            if 'cardPrice' in obj and isinstance(obj['cardPrice'], str):
                return obj['cardPrice']
            if 'ozonCardPrice' in obj and isinstance(obj['ozonCardPrice'], str):
                return obj['ozonCardPrice']

            # Check widgetStates
            if 'widgetStates' in obj:
                for key, value in obj['widgetStates'].items():
                    if isinstance(value, str):
                        try:
                            parsed = json.loads(value)
                            price = self._find_card_price(parsed, depth + 1)
                            if price:
                                return price
                        except:
                            pass
                    elif isinstance(value, dict):
                        price = self._find_card_price(value, depth + 1)
                        if price:
                            return price

            # Check other keys
            for key, value in obj.items():
                if key != 'widgetStates':
                    price = self._find_card_price(value, depth + 1)
                    if price:
                        return price

        elif isinstance(obj, list):
            for item in obj:
                price = self._find_card_price(item, depth + 1)
                if price:
                    return price

        return None

    def parse_sku(self, sku, use_api=False):
        """Parse single SKU and return price"""
        result = {
            'sku': sku,
            'price': None,
            'success': False,
            'error': None,
            'source': 'python_parser'
        }

        try:
            if use_api:
                # Use API endpoint
                url = f'https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2?url=%2Fproduct%2F{sku}'
            else:
                # Use product page
                url = f'https://www.ozon.ru/product/{sku}/'

            response = self.session.get(url, timeout=30)
            content = response.text

            # Check for blocking
            if self._is_blocked(content):
                self.consecutive_blocks += 1
                result['error'] = 'blocked'

                # Restart session
                print(f"[BLOCK] SKU {sku}: Blocked (#{self.consecutive_blocks})", file=sys.stderr)

                # Rotate IP after 3 consecutive blocks (wait for cooldown if needed)
                if self.consecutive_blocks >= 3:
                    print(f"[BLOCK] {self.consecutive_blocks} consecutive blocks, rotating IP...", file=sys.stderr)
                    rotated = self.rotate_ip(wait_if_cooldown=True)
                    if rotated:
                        time.sleep(self.post_rotation_pause)
                    else:
                        time.sleep(5)

                # Create new session
                self.session = requests.Session()
                self.session.headers.update(HEADERS)
                self._setup_proxy()
                time.sleep(3 + random.random() * 3)

                # Retry once
                response = self.session.get(url, timeout=30)
                content = response.text

                if self._is_blocked(content):
                    result['error'] = 'blocked_after_retry'
                    return result

            # Reset block counter on success
            self.consecutive_blocks = 0

            # Extract price
            if use_api:
                price = self._extract_price_from_api(content, sku)
            else:
                price = self._extract_price_from_html(content, sku)

            if price:
                result['price'] = price
                result['success'] = True
            else:
                result['error'] = 'price_not_found'

        except requests.exceptions.Timeout:
            result['error'] = 'timeout'
        except requests.exceptions.RequestException as e:
            result['error'] = str(e)
        except Exception as e:
            result['error'] = str(e)

        return result

    def parse_skus(self, skus, delay_range=(2, 4)):
        """Parse multiple SKUs with delays"""
        results = []

        # Check proxy first
        print(f"[INFO] Checking proxy...", file=sys.stderr)
        attempts = 0
        while not self.check_proxy() and attempts < 3:
            attempts += 1
            print(f"[INFO] Proxy check failed, rotating IP (attempt {attempts}/3)...", file=sys.stderr)
            self.rotate_ip(force=True)
            time.sleep(5)

        if attempts >= 3:
            print("[ERROR] Could not find working proxy", file=sys.stderr)
            return [{'sku': sku, 'success': False, 'error': 'no_working_proxy'} for sku in skus]

        for i, sku in enumerate(skus):
            print(f"[{i+1}/{len(skus)}] Parsing SKU: {sku}", file=sys.stderr)

            result = self.parse_sku(sku)
            results.append(result)

            if result['success']:
                print(f"[{i+1}/{len(skus)}] SKU {sku}: {result['price']}", file=sys.stderr)
            else:
                print(f"[{i+1}/{len(skus)}] SKU {sku}: {result['error']}", file=sys.stderr)

            # Delay between requests
            if i < len(skus) - 1:
                delay = random.uniform(*delay_range)
                time.sleep(delay)

        return results


def main():
    parser = argparse.ArgumentParser(description='Ozon Price Parser')
    parser.add_argument('skus', nargs='*', help='SKUs to parse')
    parser.add_argument('--proxy', help='Proxy URL (http://user:pass@host:port)')
    parser.add_argument('--rotate-url', help='IP rotation URL')
    parser.add_argument('--json-input', action='store_true', help='Read SKUs from stdin as JSON array')
    parser.add_argument('--delay-min', type=float, default=4, help='Minimum delay between requests')
    parser.add_argument('--delay-max', type=float, default=8, help='Maximum delay between requests')

    args = parser.parse_args()

    # Get SKUs
    skus = args.skus
    if args.json_input or not skus:
        try:
            input_data = sys.stdin.read().strip()
            if input_data:
                skus = json.loads(input_data)
        except:
            pass

    if not skus:
        print(json.dumps({'success': False, 'error': 'No SKUs provided'}))
        sys.exit(1)

    # Setup proxy config
    proxy_config = DEFAULT_PROXY.copy()
    if args.proxy:
        # Parse proxy URL
        import re
        match = re.match(r'http://([^:]+):([^@]+)@([^:]+):(\d+)', args.proxy)
        if match:
            proxy_config['username'] = match.group(1)
            proxy_config['password'] = match.group(2)
            proxy_config['host'] = match.group(3)
            proxy_config['port'] = match.group(4)

    if args.rotate_url:
        proxy_config['rotate_url'] = args.rotate_url

    # Parse
    parser = OzonParser(proxy_config)
    results = parser.parse_skus(skus, delay_range=(args.delay_min, args.delay_max))

    # Output
    successful = sum(1 for r in results if r['success'])
    output = {
        'success': successful > 0,
        'results': results,
        'summary': {
            'total': len(results),
            'successful': successful,
            'failed': len(results) - successful
        },
        'source': 'python_parser'
    }

    print(json.dumps(output, ensure_ascii=False))


if __name__ == '__main__':
    main()
