'use client'

import { usePathname } from 'next/navigation'
import { AccountDetailPage } from './account-detail-page'

export function AccountRoutePage() {
  const pathname = usePathname()
  const accountId = decodeURIComponent(pathname.split('/').filter(Boolean).at(-1) ?? '')
  return <AccountDetailPage accountId={accountId === '__dynamic__' ? '' : accountId} />
}
