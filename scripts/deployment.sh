#!/bin/sh
set -eu
umask 077
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

compose() { docker compose "$@"; }
helper() { compose run --rm --no-deps -T --user 0:0 --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER --entrypoint node -v "$(pwd)/backups:/backups" app scripts/deployment-data.mjs "$@"; }
name_valid() { case "$1" in ''|*[!a-zA-Z0-9_-]*) echo '名称只能包含英文字母、数字、下划线和短横线' >&2; exit 1;; esac; }
image_id() { docker inspect --format '{{.Image}}' "$(compose ps -a -q app)"; }
was_running=''
resume() { if [ "$was_running" = true ]; then compose up -d --no-build --no-recreate --wait --wait-timeout 90 app; fi; }
stop() {
  was_running=$(docker inspect --format '{{.State.Running}}' "$(compose ps -a -q app)")
  compose stop app
  [ "$(docker inspect --format '{{.State.Running}}' "$(compose ps -a -q app)")" = false ]
}
backup_stopped() {
  name_valid "$1"
  [ ! -e "backups/$1" ] || { echo '备份已存在' >&2; exit 1; }
  helper backup /app/var "/backups/$1" "$(image_id)"
  # Only the immutable image ID is saved; .env and initialization tokens are not copied.
}
case "${1:-}" in
  init)
    [ ! -e .env ] || { echo '.env 已存在，不覆盖' >&2; exit 1; }
    command -v openssl >/dev/null || { echo '需要 openssl 生成初始化令牌' >&2; exit 1; }
    token=$(openssl rand -hex 32)
    awk '!/^KY_SETUP_TOKEN=/' .env.example > .env
    printf 'KY_SETUP_TOKEN=%s\n' "$token" >> .env
    chmod 600 .env
    echo '已创建 .env；请在本机编辑 KY_PUBLIC_ORIGIN，再构建镜像。初始化令牌仅保存在 .env。'
    ;;
  prepare)
    mkdir -p var backups
    compose run --rm --no-deps -T --user 0:0 --cap-add CHOWN --cap-add FOWNER --entrypoint sh app -c 'chmod 700 /app/var && chown 1000:1000 /app/var'
    echo '数据目录已准备好'
    ;;
  backup)
    name=${2:-$(date -u +%Y%m%dT%H%M%SZ)}
    name_valid "$name"
    mkdir -p backups
    [ ! -e "backups/$name" ] || { echo '备份已存在' >&2; exit 1; }
    trap resume EXIT
    trap 'exit 130' INT TERM
    stop
    backup_stopped "$name"
    echo "备份已校验：backups/${name}；包含数据库和加密密钥，请私密保存。"
    ;;
  restore)
    name=${2:-}; name_valid "$name"
    [ -f .env ] || { echo '恢复需要当前站点 .env 配置' >&2; exit 1; }
    helper verify "/backups/$name"
    previous_image=$(helper image "/backups/$name")
    case "$previous_image" in sha256:*) ;; *) echo '备份镜像 ID 不正确' >&2; exit 1;; esac
    docker image inspect "$previous_image" >/dev/null
    stop
    backup_stopped "before-restore-$(date -u +%Y%m%dT%H%M%SZ)"
    helper restore "/backups/$name" /app/var
    # Persist the matched image and data version; future compose up uses this version.
    mkdir -p .tmp
    env_copy=$(mktemp .tmp/deployment-env-XXXXXX)
    awk '!/^KY_IMAGE=/' .env > "$env_copy"
    printf 'KY_IMAGE=%s\n' "$previous_image" >> "$env_copy"
    mv "$env_copy" .env
    compose up -d --no-build --wait --wait-timeout 90 app
    echo '已恢复配套数据和镜像；请核验管理登录、站点设置和 API 连接。'
    ;;
  *) echo '用法：scripts/deployment.sh init | prepare | backup [名称] | restore 名称' >&2; exit 1;;
esac
