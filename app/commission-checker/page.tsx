import { redirect } from 'next/navigation';
import CommissionCheckerPage from '../../components/CommissionCheckerPage';
import { getCommissionCheckerSession } from '../../lib/commissionCheckerAuth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function PublicCommissionCheckerPage() {
  const session = await getCommissionCheckerSession();
  if (!session) redirect('/commission-checker/login');

  return <CommissionCheckerPage standalone />;
}

