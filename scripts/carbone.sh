#!/bin/bash

# Script para gestionar Carbone (generador de PDFs)
# Uso: ./scripts/carbone.sh [start|stop|status|logs]

cd "$(dirname "$0")/../carbone"

case "$1" in
  start)
    docker compose up -d
    echo "Carbone iniciado en http://localhost:4000"
    ;;
  stop)
    docker compose down
    echo "Carbone detenido"
    ;;
  status)
    docker compose ps
    ;;
  logs)
    docker compose logs -f
    ;;
  restart)
    docker compose restart
    echo "Carbone reiniciado"
    ;;
  *)
    echo "Uso: ./scripts/carbone.sh [start|stop|status|logs|restart]"
    ;;
esac