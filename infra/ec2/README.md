# EC2 deployment for TRAPit web

This guide deploys the Next.js web app from this monorepo to one Ubuntu EC2 instance behind Nginx with HTTPS for `trapit.in` and `www.trapit.in`.

The Expo mobile app is not hosted on EC2. Only the web app under `apps/web` is deployed here.

## Recommended architecture

1. EC2 instance runs the Next.js server on port `3000`.
2. Nginx listens on ports `80` and `443`.
3. Route 53 points `trapit.in` and `www.trapit.in` to the EC2 public IP.
4. Certbot issues a Let's Encrypt certificate.
5. PM2 keeps the Node.js process running.

## 1. Create the EC2 instance

Use these baseline choices:

1. AMI: Ubuntu Server 24.04 LTS
2. Instance type: `t3.small` or larger
3. Storage: at least `20 GB`
4. Security group inbound rules:
   - SSH `22` from your IP
   - HTTP `80` from `0.0.0.0/0`
   - HTTPS `443` from `0.0.0.0/0`

Attach an Elastic IP if you want the public IP to stay stable.

## 2. Point Route 53 to EC2

In the hosted zone for `trapit.in` create:

1. `A` record for `trapit.in` to the EC2 public IP or Elastic IP
2. `A` record for `www.trapit.in` to the same IP

Wait for DNS to resolve before requesting the SSL certificate.

## 3. Install server dependencies

SSH into the instance and run:

```bash
sudo apt update
sudo apt install -y nginx git curl build-essential
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g corepack pm2
corepack enable
```

Verify versions:

```bash
node -v
npm -v
pnpm -v
```

If `pnpm -v` fails, run:

```bash
corepack prepare pnpm@9.15.0 --activate
```

## 4. Upload the code

Clone into `/var/www/trapit`:

```bash
sudo mkdir -p /var/www
sudo chown -R $USER:$USER /var/www
git clone <your-repo-url> /var/www/trapit
cd /var/www/trapit
```

If the repo is already present, pull the latest changes instead.

## 5. Add production environment variables

Create the production env file:

```bash
cp .env.example apps/web/.env.production
```

Edit `apps/web/.env.production` and fill in at least:

```bash
COGNITO_REGION=...
COGNITO_USER_POOL_ID=...
COGNITO_WEB_CLIENT_ID=...
COGNITO_MOBILE_CLIENT_ID=...
COGNITO_ADMIN_GROUP=admins
COGNITO_USER_GROUP=users
NEXT_PUBLIC_COGNITO_REGION=...
NEXT_PUBLIC_COGNITO_USER_POOL_ID=...
NEXT_PUBLIC_COGNITO_WEB_CLIENT_ID=...
EXPO_PUBLIC_API_BASE_URL=https://trapit.in
```

If you want automatic user group assignment in Cognito, also provide AWS credentials on the instance with permission for `cognito-idp:AdminAddUserToGroup`.

One common EC2 approach is to attach an IAM role to the instance instead of storing AWS keys in env files.

## 6. Install dependencies and build

From `/var/www/trapit` run:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @trapit/web build
```

## 7. Start the app with PM2

Copy the PM2 config from this folder and start it:

```bash
cp infra/ec2/ecosystem.config.cjs /var/www/trapit/ecosystem.config.cjs
pm2 start /var/www/trapit/ecosystem.config.cjs
pm2 save
pm2 startup systemd
```

After `pm2 startup systemd`, run the command PM2 prints to finish startup registration.

Check the app:

```bash
pm2 status
pm2 logs trapit-web
curl http://127.0.0.1:3000
```

## 8. Configure Nginx reverse proxy

Copy the sample config:

```bash
sudo cp infra/ec2/nginx-trapit.conf /etc/nginx/sites-available/trapit
sudo ln -s /etc/nginx/sites-available/trapit /etc/nginx/sites-enabled/trapit
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

The checked-in Nginx config includes larger proxy header buffers for Cognito sign-in responses. If you already had a live config before this change, copy the updated file to the server again and reload Nginx so the buffer settings take effect.

At this stage HTTP should work, but HTTPS will not until the certificate is created.

## 9. Issue the HTTPS certificate

Install Certbot:

```bash
sudo apt install -y certbot python3-certbot-nginx
```

Request the certificate:

```bash
sudo certbot --nginx -d trapit.in -d www.trapit.in
```

Choose the redirect option when Certbot asks whether HTTP traffic should redirect to HTTPS.

Then verify renewal:

```bash
sudo systemctl status certbot.timer
sudo certbot renew --dry-run
```

## 10. Verify the deployment

Test these URLs:

1. `http://trapit.in`
2. `https://trapit.in`
3. `http://www.trapit.in`
4. `https://www.trapit.in`

Expected behavior:

1. HTTP redirects to HTTPS
2. `www.trapit.in` redirects to `trapit.in`
3. The Next.js app loads over HTTPS

## Updating after code changes

When you push new code to the server:

```bash
cd /var/www/trapit
git pull
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @trapit/web build
pm2 restart trapit-web
```

## Common issues

### App works on port 3000 but not in browser

Check:

1. Security group allows ports `80` and `443`
2. Nginx is running: `sudo systemctl status nginx`
3. DNS records point to the correct public IP
4. PM2 is running the app: `pm2 status`

### Auth cookies are missing in production

This app marks cookies as secure in production. Access the site over `https://trapit.in`, not plain HTTP.

### Cognito user group assignment fails

The server-side sign-up route needs AWS permission to call `AdminAddUserToGroup`. Use an EC2 IAM role with the required policy.