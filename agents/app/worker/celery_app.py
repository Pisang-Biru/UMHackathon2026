import os
from celery import Celery
from celery.schedules import crontab
from dotenv import load_dotenv

load_dotenv()

BROKER_URL = os.environ.get("CELERY_BROKER_URL", "amqp://guest:guest@localhost:5672//")

celery = Celery(
    "pisang_agents",
    broker=BROKER_URL,
    include=["app.worker.tasks", "app.worker.finance_check"],
)

celery.conf.update(
    task_ignore_result=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    task_default_queue="memory",
    broker_connection_retry_on_startup=True,
    beat_schedule={
        "summarize-old-turns": {
            "task": "app.worker.tasks.summarize_old_turns",
            "schedule": float(os.environ.get("MEMORY_SUMMARY_INTERVAL_SEC", "3600")),
        },
        "expire-pending-orders": {
            "task": "app.worker.tasks.expire_pending_orders",
            "schedule": float(os.environ.get("ORDER_EXPIRY_CHECK_INTERVAL_SEC", "300")),
        },
        "prune-agent-events-daily": {
            "task": "app.worker.tasks.prune_agent_events",
            "schedule": crontab(hour=3, minute=0),
        },
    },
)
