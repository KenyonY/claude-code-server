-include .env
export

PORT := $(or $(CLAUDE_CODE_SERVER_PORT),8333)
LOG_DIR := logs

.PHONY: start start-bg frontend stop logs

# 前台启动后端
start:
	@echo "启动后端 :$(PORT)"
	@uv run claude-code-server

# 后台启动后端
start-bg:
	@mkdir -p $(LOG_DIR)
	@echo "后台启动后端 :$(PORT)"
	@nohup uv run claude-code-server >> $(LOG_DIR)/server.log 2>&1 &
	@echo "日志: make logs"

# 前端开发服务器
frontend:
	@cd frontend && npm run dev

# 停止后端进程
stop:
	@echo "停止服务..."
	@-lsof -ti:$(PORT) | xargs -r kill 2>/dev/null
	@echo "已停止"

# 查看日志
logs:
	@tail -f $(LOG_DIR)/server.log
