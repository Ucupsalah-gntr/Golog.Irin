CREATE POLICY backend_only
ON public.user_room_access
AS PERMISSIVE
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);
