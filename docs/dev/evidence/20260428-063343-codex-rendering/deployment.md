# Codex rendering dev deployment evidence

Date (UTC): 2026-04-28T17:46:53Z
Repository: /dev/shm/dev-workspace/happy-dev
Target service: happy-web-dev only
Target URL checked: http://localhost:8097/

## Image confirmation

- Current happy-app:dev image ID: `sha256:adbd3a6cb0e5ebaca0b66fe2f0d0b2ee9356fb20d659fcf805318a5536784423`
- Expected image ID from prior worker: `sha256:adbd3a6cb0e5ebaca0b66fe2f0d0b2ee9356fb20d659fcf805318a5536784423`
- Match: yes

## Deployment action

Recreated only compose service `happy-web-dev` from /root/deploy. No rebuild was performed.

## Post-deploy verification

- happy-web-dev running image ID: `sha256:adbd3a6cb0e5ebaca0b66fe2f0d0b2ee9356fb20d659fcf805318a5536784423`
- Running image matches happy-app:dev: yes
- happy-web-dev container status: `running`
- happy-web-dev container Created: `2026-04-28T17:46:08.123475716Z`

## HTTP verification

Headers from http://localhost:8097/:

```
HTTP/1.1 200 OK
Server: nginx/1.29.6
Date: Tue, 28 Apr 2026 17:46:53 GMT
Content-Type: text/html
Content-Length: 1603
Last-Modified: Tue, 28 Apr 2026 17:44:41 GMT
Connection: keep-alive
Vary: Accept-Encoding
ETag: "69f0f209-643"
Accept-Ranges: bytes
```

HTML sample from http://localhost:8097/:

```html
<!DOCTYPE html> <html lang="en">   <head>     <meta charset="utf-8" />     <meta httpEquiv="X-UA-Compatible" content="IE=edge" />     <meta name="viewport" content="width=device-width, initial-scale=1
```

## Conclusion

The current already-built dev image is deployed to happy-web-dev and localhost:8097 serves HTML.
The user can manually verify the real Codex transcript again on the dev web app.
