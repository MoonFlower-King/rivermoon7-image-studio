FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN adduser --system --group --uid 10001 appuser

COPY app.py /app/app.py
COPY newapi-image-playground.html /app/newapi-image-playground.html
COPY newapi-image-entry.js /app/newapi-image-entry.js

USER appuser
EXPOSE 8320

CMD ["python", "/app/app.py"]
