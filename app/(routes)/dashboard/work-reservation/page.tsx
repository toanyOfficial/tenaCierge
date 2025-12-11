import { redirect } from 'next/navigation';

import WorkReservationClient from './WorkReservationClient';

import { getProfileWithDynamicRoles } from '@/src/server/profile';
import { listOpenRoomsByBuilding, listWorkReservations } from '@/src/server/workReservation';

export const metadata = {
  title: '요청사항관리 | TenaCierge Ops'
};

export default async function WorkReservationPage() {
  const profile = await getProfileWithDynamicRoles();
  if (!profile.roles.includes('admin')) {
    redirect('/dashboard');
  }

  const [reservations, buildings] = await Promise.all([listWorkReservations(), listOpenRoomsByBuilding()]);

  return <WorkReservationClient profile={profile} initialReservations={reservations} buildingOptions={buildings} />;
}
