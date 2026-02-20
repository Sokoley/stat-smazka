#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "=== Обновление stat.smazka.ru ==="
echo ""

echo "1. Получение изменений из Git..."
git pull origin main

echo ""
echo "2. Сборка Docker образа..."
docker compose build

echo ""
echo "3. Перезапуск контейнера..."
docker compose down
docker compose up -d

echo ""
echo "4. Ожидание запуска..."
sleep 5

echo ""
echo "5. Проверка статуса..."
docker compose ps

echo ""
echo "=== Готово! ==="
