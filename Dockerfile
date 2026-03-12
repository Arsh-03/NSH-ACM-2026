# Use the official Ubuntu 22.04 as the base image
FROM ubuntu:22.04

# Set environment variables to prevent interactive prompts during install
ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

# 1. Install System Dependencies
# We include git and build-essential just in case any library needs a quick compile
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    git \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# 2. Set the working directory inside the container
WORKDIR /app

# 3. Copy only requirements first to leverage Docker cache
COPY requirements.txt .

# 4. Install Python dependencies
# Using --no-cache-dir keeps the image size small
RUN pip3 install --no-cache-dir --upgrade pip && \
    pip3 install --no-cache-dir -r requirements.txt

# 5. Copy the rest of your ACM source code
COPY . .

# 6. Expose Port 8000 for the Simulation Grader
EXPOSE 8000

# 7. Start the FastAPI server
# main.py internally calls uvicorn.run(app, host="0.0.0.0", port=8000)
CMD ["python3", "main.py"]