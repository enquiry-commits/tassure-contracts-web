This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
Mon Aug 24 14:32:01 MPST 2026

## Proposal release gate

Generated proposals are not downloadable immediately. The API stores each DOCX as a private draft and queues a visual QA job. A Windows worker opens the draft in Microsoft Word, exports it to PDF, renders every page to PNG, and checks the page images. Only a passing job is copied to the final contract path and added to the contract records table.

Warnings require a person to review the contact sheet in **Admin Dashboard → Microsoft Word Visual QA** and choose **Approve & release** or **Reject**. Render failures remain blocked and can be retried. Existing proposals are not overwritten until the replacement has passed.

### Windows worker

Requirements: Microsoft Word, Poppler (`pdftoppm` on `PATH`), project dependencies, and Supabase settings in `.env.worker.local` (preferred) or `.env.local`.

Install and start the current-user scheduled task:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-visual-qa-worker.ps1
```

Run one queue pass manually:

```powershell
npm run qa:worker:once
```

The worker heartbeat is written to private storage and shown in the Admin Dashboard. A render interrupted for more than 15 minutes is automatically retried.

Use a dedicated Windows user session for the worker. If Word is already open interactively, the queue waits instead of risking Office automation conflicts or closing a person's document.
