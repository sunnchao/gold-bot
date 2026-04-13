import { AccountRoutePage } from '../../../components/account-route-page'

export const dynamicParams = false

export function generateStaticParams() {
  return [{ accountId: '__dynamic__' }]
}

export default function Page() {
  return <AccountRoutePage />
}
