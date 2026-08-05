import { redirect } from 'next/navigation';
import { getCommissionCheckerSession } from '../../../lib/commissionCheckerAuth';
import CommissionCheckerLoginForm from './LoginForm';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function CommissionCheckerLoginPage() {
  const session = await getCommissionCheckerSession();
  if (session) redirect('/commission-checker');
  return <CommissionCheckerLoginForm />;
}

