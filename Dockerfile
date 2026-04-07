FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . /app/gold_bolt_server

EXPOSE 8880

CMD ["python3", "-m", "gold_bolt_server.app"]
