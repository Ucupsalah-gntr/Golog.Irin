ALTER TABLE public.requests
  ALTER COLUMN status SET DEFAULT 'submitted';

ALTER TABLE public.requests
  ADD CONSTRAINT requests_status_lifecycle_check
  CHECK (status IN ('submitted', 'approved', 'partial', 'rejected'));
