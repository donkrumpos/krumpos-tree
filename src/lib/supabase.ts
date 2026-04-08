import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://nfxnxcfgdcvdkxtuupbd.supabase.co';
const supabaseKey = 'sb_publishable_Cb14TnZ-HrVLYCohQXxkRA_34mPSc7P';

export const supabase = createClient(supabaseUrl, supabaseKey);
