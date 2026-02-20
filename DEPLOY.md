# Инструкция по деплою stat.smazka.ru

## 1. Подготовка сервера

### 1.1 Установка Docker (если не установлен)

```bash
# Обновление пакетов
sudo yum update -y

# Установка Docker
sudo yum install -y yum-utils
sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo yum install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Запуск Docker
sudo systemctl start docker
sudo systemctl enable docker

# Добавить пользователя www-root в группу docker
sudo usermod -aG docker www-root
```

### 1.2 Включение модулей Apache

```bash
# Для CentOS/RHEL с httpd
sudo yum install -y mod_proxy_html

# Проверить, что модули включены в httpd.conf:
# LoadModule proxy_module modules/mod_proxy.so
# LoadModule proxy_http_module modules/mod_proxy_http.so
# LoadModule headers_module modules/mod_headers.so
# LoadModule rewrite_module modules/mod_rewrite.so
```

## 2. Настройка GitHub репозитория

### 2.1 Создание репозитория

1. Создайте новый приватный репозиторий на GitHub
2. На локальной машине:

```bash
cd /Users/sokoley/Desktop/docker/stat
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin git@github.com:Sokoley/stat-smazka.git
git push -u origin main
```

### 2.2 Настройка SSH-ключа на сервере

```bash
# На сервере под пользователем www-root
sudo su - www-root
ssh-keygen -t ed25519 -C "server@stat.smazka.ru"
cat ~/.ssh/id_ed25519.pub
```

Добавьте этот ключ в GitHub: Settings → Deploy Keys → Add deploy key

## 3. Клонирование проекта на сервер

```bash
# На сервере
cd /var/www/www-root/data/www
rm -rf stat.smazka.ru/*  # Очистить текущее содержимое

git clone git@github.com:Sokoley/stat-smazka.git stat.smazka.ru
cd stat.smazka.ru

# Создать директорию для данных
mkdir -p data/pricecheck
```

## 4. Настройка Apache

### 4.1 Редактирование vhost.conf

```bash
sudo nano /etc/httpd/conf/users-resources/www-root/vhost.conf
```

Добавьте в конец файла:

```apache
# Proxy for stat.smazka.ru Docker container
<IfModule mod_proxy.c>
    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:3000/
    ProxyPassReverse / http://127.0.0.1:3000/

    # Timeouts for parsing
    ProxyTimeout 300
</IfModule>

<IfModule mod_headers.c>
    RequestHeader set X-Forwarded-Proto "https"
</IfModule>
```

### 4.2 Отключение обработки PHP для этого сайта

В конфигурации VirtualHost закомментируйте или удалите блоки `<FilesMatch "\.ph...">`
или добавьте в vhost.conf:

```apache
# Disable PHP for this site (Node.js app)
<FilesMatch "\.ph(p[3-5]?|tml)$">
    SetHandler none
</FilesMatch>
```

### 4.3 Перезапуск Apache

```bash
sudo apachectl configtest
sudo systemctl restart httpd
```

## 5. Запуск Docker контейнера

```bash
cd /var/www/www-root/data/www/stat.smazka.ru

# Сборка образа
docker compose build

# Запуск контейнера
docker compose up -d

# Проверка статуса
docker compose ps
docker compose logs -f
```

## 6. Автозапуск при перезагрузке

Docker контейнер с `restart: unless-stopped` автоматически запустится при перезагрузке сервера.

## 7. Обновление приложения

Создайте скрипт `/var/www/www-root/data/www/stat.smazka.ru/update.sh`:

```bash
#!/bin/bash
cd /var/www/www-root/data/www/stat.smazka.ru

echo "Pulling latest changes..."
git pull origin main

echo "Rebuilding Docker image..."
docker compose build

echo "Restarting container..."
docker compose down
docker compose up -d

echo "Done! Checking status..."
docker compose ps
```

Сделайте исполняемым:
```bash
chmod +x update.sh
```

## 8. Полезные команды

```bash
# Просмотр логов
docker compose logs -f

# Перезапуск контейнера
docker compose restart

# Остановка
docker compose down

# Вход в контейнер
docker compose exec stat-app sh

# Проверка здоровья
curl http://127.0.0.1:3000/

# Проверка использования ресурсов
docker stats stat-dashboard
```

## 9. Troubleshooting

### Порт 3000 занят
```bash
sudo lsof -i :3000
# или измените порт в docker-compose.yml
```

### Chrome не запускается в Docker
```bash
# Проверьте shm_size в docker-compose.yml (должен быть минимум 2gb)
# Проверьте логи
docker compose logs stat-app | grep -i chrome
```

### Ошибка прокси Apache
```bash
# Проверьте модули
httpd -M | grep proxy

# Проверьте SELinux
sudo setsebool -P httpd_can_network_connect 1
```

### Basic Auth не работает
Basic Auth настроен в Apache и будет работать автоматически, так как Apache проксирует запросы.

## 10. Структура файлов на сервере

```
/var/www/www-root/data/www/stat.smazka.ru/
├── data/                    # Данные (volume)
│   └── pricecheck/         # Данные парсера цен
├── src/                     # Исходный код
├── docker-compose.yml       # Docker конфигурация
├── Dockerfile              # Сборка образа
├── package.json            # Зависимости Node.js
└── update.sh               # Скрипт обновления
```
