"""
日志配置 — 按日期归档 + 自动轮转清理
"""
import os
import logging
from logging.handlers import TimedRotatingFileHandler
from datetime import datetime


def setup_logging():
    log_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'logs')
    os.makedirs(log_dir, exist_ok=True)

    log_file = os.path.join(log_dir, 'server.log')

    # 格式
    fmt = logging.Formatter(
        '%(asctime)s | %(levelname)-5s | %(name)s | %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S',
    )

    # 控制台输出
    console = logging.StreamHandler()
    console.setFormatter(fmt)

    # 文件输出 — 每天午夜轮转，保留 14 天
    file_handler = TimedRotatingFileHandler(
        log_file,
        when='midnight',
        interval=1,
        backupCount=14,        # 保留14天
        encoding='utf-8',
    )
    file_handler.suffix = '%Y%m%d.log'   # 归档命名: server.log.20260412.log
    file_handler.setFormatter(fmt)

    logging.basicConfig(
        level=logging.INFO,
        handlers=[console, file_handler],
    )