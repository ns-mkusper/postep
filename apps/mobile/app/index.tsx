import { Redirect } from 'expo-router';

import { useOrgConfig } from '../store/orgConfig';

export default function IndexRoute() {
  const roots = useOrgConfig((state) => state.roots);
  const roamRoots = useOrgConfig((state) => state.roamRoots);
  const hasSources = roots.length > 0 || roamRoots.length > 0;

  return <Redirect href={hasSources ? '/library' : '/settings'} />;
}
