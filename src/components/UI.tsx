import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { TransactionSheet, type TxDefaults } from './TransactionSheet';

interface UI {
  openTransaction: (opts?: { id?: string; defaults?: TxDefaults }) => void;
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
}

const UIContext = createContext<UI>(null!);

export function UIProvider({ children }: { children: ReactNode }) {
  const [tx, setTx] = useState<{ open: boolean; id?: string; defaults?: TxDefaults }>({ open: false });
  const [commandOpen, setCommandOpen] = useState(false);
  const openTransaction = useCallback((opts: { id?: string; defaults?: TxDefaults } = {}) => setTx({ open: true, ...opts }), []);
  return (
    <UIContext.Provider value={{ openTransaction, commandOpen, setCommandOpen }}>
      {children}
      <TransactionSheet open={tx.open} id={tx.id} defaults={tx.defaults} onClose={() => setTx({ open: false })} />
    </UIContext.Provider>
  );
}

export const useUI = () => useContext(UIContext);
