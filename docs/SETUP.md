# Setup

Four accounts are needed: Neon (database), Anthropic (model), GitHub (the App),
and Vercel (hosting). Do them in this order. Each step ends with values to put
in `.env.local` (copy `.env.example` first) and later in Vercel.

## 1. Neon database

1. Go to https://console.neon.tech and sign in.
2. Click **New Project**. Name it `second-look`, pick the region closest to you, click **Create**.
3. On the project dashboard click **Connect**. Leave "Connection pooling" on. Copy the connection string that starts with `postgresql://`.
4. Put it in `.env.local` as `DATABASE_URL=...`.
5. Create the tables:
   ```
   npm run db:migrate
   ```

## 2. Anthropic API key

1. Go to https://console.anthropic.com and sign in.
2. Open **Settings**, then **API keys**, then **Create key**. Name it `second-look`.
3. Copy the key (it is shown once) into `.env.local` as `ANTHROPIC_API_KEY=...`.
4. Under **Settings**, **Limits**, set a monthly spend limit you are comfortable with.
5. Check that it works by running the eval (10 small requests):
   ```
   npm run eval
   ```

## 3. Auth secret

```
npx auth secret
```

This writes `AUTH_SECRET` to `.env.local`. It signs session cookies and salts the paste-mode rate-limit keys.

## 4. Vercel project (first deploy)

Deploy before creating the GitHub App, because the App needs the public URL.

1. Go to https://vercel.com/new and import the `second-look` repository.
2. Framework preset: **Next.js**. Leave build settings as they are.
3. Open **Environment Variables** and add `DATABASE_URL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, and `AUTH_SECRET` with the values from `.env.local`.
4. Click **Deploy**. When it finishes, note the production URL, for example `https://second-look-review.vercel.app`. The home page and paste mode work at this point.
5. In the project's **Settings**, **Functions**, confirm **Fluid compute** is on (it is the default for new projects). The review needs up to 300 seconds.

## 5. GitHub App

1. Go to https://github.com/settings/apps and click **New GitHub App**.
2. Fill in:
   - **GitHub App name:** `Second Look (your-username)` (names are global, so add something unique)
   - **Homepage URL:** your Vercel URL
   - **Callback URL:** `<your Vercel URL>/api/auth/callback/github`
   - **Request user authorization (OAuth) during installation:** leave unchecked
   - **Webhook, Active:** checked
   - **Webhook URL:** `<your Vercel URL>/api/webhooks/github`
   - **Webhook secret:** run `openssl rand -hex 32` and paste the result. Also save it as `GITHUB_WEBHOOK_SECRET`.
3. **Repository permissions:**
   - **Checks:** Read and write
   - **Contents:** Read-only
   - **Metadata:** Read-only (selected automatically)
   - **Pull requests:** Read and write
4. **Subscribe to events:** check **Pull request**.
5. **Where can this GitHub App be installed?** Only on this account.
6. Click **Create GitHub App**.
7. On the app page:
   - Copy **App ID** into `GITHUB_APP_ID`.
   - Copy **Client ID** into `AUTH_GITHUB_ID`.
   - Click **Generate a new client secret** and copy it into `AUTH_GITHUB_SECRET`.
   - Scroll to **Private keys**, click **Generate a private key**. A `.pem` file downloads. Convert it to one line and put the output in `GITHUB_APP_PRIVATE_KEY`:
     ```
     awk 'NF {sub(/\r/, ""); printf "%s\\n", $0}' ~/Downloads/your-app.private-key.pem
     ```
8. In the left menu click **Install App**, then **Install** next to your account. Choose **Only select repositories** and pick the repository to review.

## 6. Finish the Vercel configuration

1. In Vercel, open **Settings**, **Environment Variables** and add: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, and `APP_URL` (your Vercel URL, no trailing slash).
2. Open **Deployments**, click the menu on the latest deployment, and choose **Redeploy** so the new variables take effect.

## 7. Try it

1. Open a pull request in the repository where the App is installed.
2. A check named **Second Look** appears on the PR, in progress.
3. Open `<your Vercel URL>/dashboard`, sign in with GitHub, and open the review.
4. Confirm or reject each finding, then click **Publish review**.
5. The review appears on the PR and the check completes.

If nothing happens, open the App's **Advanced** tab on GitHub. It lists recent webhook deliveries with the response from your server. A 401 means the webhook secret does not match.

## Local development

```
npm install
cp .env.example .env.local   # fill in as above
npm run db:migrate
npm run dev
```

Paste mode and the dashboard work locally. For the dashboard login, add `http://localhost:3000/api/auth/callback/github` as a second callback URL on the GitHub App. Webhooks need a public URL; use the Vercel deployment, or a tunnel such as `npx smee-client`.
