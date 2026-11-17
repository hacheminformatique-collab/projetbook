CREATE TYPE account_role AS ENUM (
  'client',
  'professional',
  'commercial',
  'super_admin'
);

CREATE TYPE account_status AS ENUM (
  'pending',
  'active',
  'suspended'
);

CREATE TYPE professional_application_status AS ENUM (
  'submitted',
  'in_review',
  'approved',
  'rejected'
);

CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role account_role NOT NULL,
  status account_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT accounts_email_length CHECK (CHAR_LENGTH(email) BETWEEN 3 AND 254)
);

CREATE UNIQUE INDEX accounts_email_case_insensitive_unique
  ON accounts (LOWER(email));

CREATE TABLE client_profiles (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  date_of_birth DATE NOT NULL,
  phone_number TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE professional_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  business_name TEXT NOT NULL,
  business_category TEXT NOT NULL CHECK (
    business_category IN (
      'coiffeur',
      'barbier',
      'manucure',
      'institut',
      'bien-etre',
      'maquillage',
      'spa',
      'massage'
    )
  ),
  wilaya_code CHAR(2) NOT NULL CHECK (wilaya_code BETWEEN '01' AND '58'),
  city TEXT NOT NULL,
  address TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  status professional_application_status NOT NULL DEFAULT 'submitted',
  reviewed_by UUID REFERENCES accounts(id) ON DELETE SET NULL,
  review_note TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  CONSTRAINT professional_application_review_consistency CHECK (
    (status IN ('approved', 'rejected') AND reviewed_at IS NOT NULL)
    OR (status IN ('submitted', 'in_review') AND reviewed_at IS NULL)
  )
);

CREATE UNIQUE INDEX professional_applications_one_open_per_account
  ON professional_applications (account_id)
  WHERE status IN ('submitted', 'in_review');

CREATE INDEX professional_applications_status_submitted_at
  ON professional_applications (status, submitted_at);

CREATE TABLE professional_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE RESTRICT,
  display_name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE salons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_profile_id UUID NOT NULL REFERENCES professional_profiles(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  wilaya_code CHAR(2) NOT NULL CHECK (wilaya_code BETWEEN '01' AND '58'),
  city TEXT NOT NULL,
  address TEXT NOT NULL,
  phone_number TEXT,
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX salons_public_location
  ON salons (wilaya_code, city)
  WHERE is_public = TRUE;

CREATE TABLE services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (
    category IN (
      'coiffeur',
      'barbier',
      'manucure',
      'institut',
      'bien-etre',
      'maquillage',
      'spa',
      'massage'
    )
  ),
  description TEXT,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 1 AND 1440),
  price_dzd BIGINT NOT NULL CHECK (price_dzd >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX services_active_by_salon
  ON services (salon_id, category)
  WHERE is_active = TRUE;
