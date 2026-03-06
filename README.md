# Adashi Dashboard

A modern dashboard application built with Next.js and Supabase.

## Features

- User authentication and authorization
- Personalized dashboard with user profile management
- Secure password management
- Email verification and password reset functionality
- Responsive design with Tailwind CSS
- Modern UI components with shadcn/ui

## Getting Started

1. First, create a Supabase project at [supabase.com](https://supabase.com)

2. Clone this repository:

   ```bash
   git clone [your-repo-url]
   cd adashi
   ```

3. Install dependencies:

   ```bash
   npm install
   ```

4. Copy `.env.example` to `.env.local` and update the following:

  ```env
  NEXT_PUBLIC_SUPABASE_URL=[INSERT SUPABASE PROJECT URL]
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=[INSERT SUPABASE PROJECT API PUBLISHABLE OR ANON KEY]
  GMAIL_APP_PASSWORD=[YOUR GMAIL APP PASSWORD]
  ```

  Both `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` can be found in [your Supabase project's API settings](https://supabase.com/dashboard/project/_?showConnect=true)

5. Run the development server:

   ```bash
   npm run dev
   ```

   The application should now be running on [localhost:3000](http://localhost:3000/).

## Deployment

This application can be deployed to any platform that supports Next.js applications, such as Vercel, Netlify, or your own server.



  Issues Found (Priority Order)

  Security (Critical):
  1. Admin role check is broken — email?.includes('admin') grants admin to any email containing "admin" (e.g.
  myadminwork@gmail.com)
  2. RLS removed from transactions — any authenticated user can read/write any transaction
  3. No auth on server actions — recordContribution doesn't verify the caller is an admin
  4. Default passwords = phone numbers — extremely weak credentials
  5. No middleware-based route protection — relies on per-page checks, easy to miss routes

  Scalability:
  6. Balances computed on-the-fly from all transactions — will degrade with volume
  7. No pagination — admin page fetches ALL transactions; scheme detail caps at 300
  8. Transaction detachment on payout (scheme_id = null) breaks historical reporting

  Code Quality:
  9. Flat component structure — 30+ components in one folder, no feature grouping
  10. Duplicate cn utility defined locally in admin page instead of importing
  11. .env.example appears to contain a real Supabase key
  12. No input validation on server action parameters

  Missing from PRD:
  - No offline/PWA support
  - No SMS/WhatsApp notifications
  - No OTP authentication for members
