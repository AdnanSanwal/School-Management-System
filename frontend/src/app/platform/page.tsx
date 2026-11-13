'use client';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { BrandConsole } from '@/components/brands/BrandConsole';
export default function PlatformPage() {
  return <DashboardLayout title="Brands & branches" allowedRoles={['SUPER_ADMIN']}><BrandConsole /></DashboardLayout>;
}
