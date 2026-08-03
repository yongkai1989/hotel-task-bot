import ChillerCleaningPage from '../chiller-cleaning/page';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function RegencyFnbRoutineDutiesPage() {
  return <ChillerCleaningPage branch="regency" />;
}
