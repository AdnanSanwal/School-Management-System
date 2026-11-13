'use client';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { BrandConsole } from '@/components/brands/BrandConsole';
export default function BrandsPage() {
  return <DashboardLayout title="All branches" allowedRoles={['OWNER']}><BrandConsole /></DashboardLayout>;
}
