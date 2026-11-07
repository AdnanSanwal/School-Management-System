import { Loading } from '../components/ui';

// The root layout's auth gate redirects from here once storage has loaded.
export default function Index() {
  return <Loading />;
}
