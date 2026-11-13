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

One command registers the app and writes its credentials to `.env.local`:

```
npm run github-app:create -- https://your-vercel-url.vercel.app "Second Look (your-username)"
```

1. The command prints `http://localhost:8787`. Open it in a browser where you are signed in to GitHub.
2. GitHub shows the app name. Click **Create GitHub App**.
3. The browser returns to a page that says the app was created. `.env.local` now has `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, and `APP_URL`. The values are not printed.
4. Click the **install it on a repository** link on that page. Choose **Only select repositories** and pick the repository to review.

The app is private to your account and asks for the least it needs: read access to code, write access to checks and pull request reviews, and the `pull_request` event. App names are global on GitHub, so add something unique to the name.

To do it by hand instead, create an app at https://github.com/settings/apps with those permissions, webhook URL `<your URL>/api/webhooks/github`, and callback URL `<your URL>/api/auth/callback/github`, then copy the same six values into `.env.local`.

## 6. Finish the Vercel configuration

1. In Vercel, open **Settings**, **Environment Variables**, click **Add Environment Variable**, and paste the six new lines from `.env.local` into the Key field. Vercel splits them into six variables. Optionally add `DEMO_PULL_REQUEST` (for example `your-name/your-repo#2`) to show one published review on the public `/demo` page.
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

The home page, live reviews of pasted code, and the dashboard work locally. For the dashboard login, add `http://localhost:3000/api/auth/callback/github` as a second callback URL on the GitHub App. Webhooks need a public URL; use the Vercel deployment, or a tunnel such as `npx smee-client`.
