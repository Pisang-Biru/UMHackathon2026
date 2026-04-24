import os
from celery import Celery
from dotenv import load_dotenv

load_dotenv()

BROKER_URL = os.environ.get("CELERY_BROKER_URL", "amqp://guest:guest@localhost:5672//")

celery = Celery(
    "pisang_agents",
    broker=BROKER_URL,
    include=["app.worker.tasks"],
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
    },
)
