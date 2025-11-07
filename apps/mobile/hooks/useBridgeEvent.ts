import { useEffect } from 'react';
import { BridgeEvent, subscribeBridgeEvent } from '@postep/bridge';

export function useBridgeEvent(event: BridgeEvent, listener: () => void) {
  useEffect(() => {
    const unsubscribe = subscribeBridgeEvent(event, listener);
    return () => unsubscribe();
  }, [event, listener]);
}
