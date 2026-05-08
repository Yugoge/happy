### dev service health after frontend deploy
2026-05-07T07:19:38Z
frontend http://localhost:8097 head:
HTTP/1.1 200 OK
Server: nginx/1.29.6
Date: Thu, 07 May 2026 07:19:38 GMT
Content-Type: text/html
Content-Length: 1603
Last-Modified: Thu, 07 May 2026 07:19:09 GMT
Connection: keep-alive
Vary: Accept-Encoding
ETag: "69fc3ced-643"
Accept-Ranges: bytes

<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta httpEquiv="X-UA-Compatible" content="IE
backend http://localhost:3005/health:
{"status":"ok","timestamp":"2026-05-07T07:19:38.076Z","service":"happy-server"}
happy-web-dev image/container:
container=/happy-web-dev image=sha256:c9c130535cfb560eafe9d5860f3f130b7a87aa78548763d401f61c932a9a03e7 started=2026-05-07T07:19:20.875581565Z
image_id=sha256:c9c130535cfb560eafe9d5860f3f130b7a87aa78548763d401f61c932a9a03e7 created=2026-05-07T07:19:19.100245877Z
health_exit=0
