#!/bin/bash
# Publica automáticamente: si hay cambios sin guardar, corre las pruebas y,
# solo si pasan, hace commit y push a main (Vercel publica solo).
cd "$(dirname "$0")/.." || exit 0

msg() { printf '{"systemMessage":"%s"}\n' "$1"; }

# Árbol limpio: no hace nada.
[ -z "$(git status --porcelain)" ] && exit 0

# Solo publica desde la rama main.
[ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || { msg "Auto-publicar: no estás en la rama main, no se subió nada."; exit 0; }

if ! npm test >/tmp/auto-publicar-test.log 2>&1; then
  msg "Auto-publicar: las pruebas FALLARON, no se subió nada. Revisa /tmp/auto-publicar-test.log"
  exit 0
fi

git add -A
git commit -q -m "Actualización automática $(date +%Y-%m-%d\ %H:%M)" || { msg "Auto-publicar: no se pudo crear el commit."; exit 0; }

if git push -q origin main >/tmp/auto-publicar-push.log 2>&1; then
  msg "Auto-publicar: cambios subidos a main. Vercel está publicando."
else
  msg "Auto-publicar: el commit se hizo pero el push FALLÓ. Revisa /tmp/auto-publicar-push.log"
fi
exit 0
