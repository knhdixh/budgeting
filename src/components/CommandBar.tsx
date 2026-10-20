import { Command } from 'cmdk';
import { useNavigate } from 'react-router';
import { useLookups } from '../data';
import { money } from '../util';
import { useUI } from './UI';

export function CommandBar() {
  const { commandOpen, setCommandOpen, openTransaction } = useUI();
  const { openAccounts, categories } = useLookups();
  const navigate = useNavigate();
  const go = (fn: () => void) => { setCommandOpen(false); fn(); };

  return (
    <Command.Dialog open={commandOpen} onOpenChange={setCommandOpen} label="Command bar">
      <Command.Input placeholder="Type a command or search" />
      <Command.List>
        <Command.Empty>Nothing found.</Command.Empty>
        <Command.Group heading="Actions">
          <Command.Item onSelect={() => go(() => openTransaction())}>New transaction<span className="muted">N</span></Command.Item>
          <Command.Item onSelect={() => go(() => navigate('/accounts?new=1'))}>New account</Command.Item>
          <Command.Item onSelect={() => go(() => navigate('/settings#import'))}>Import CSV</Command.Item>
          <Command.Item onSelect={() => go(() => navigate('/transactions?category=uncategorized'))}>Review uncategorized</Command.Item>
        </Command.Group>
        <Command.Group heading="Go to">
          <Command.Item onSelect={() => go(() => navigate('/'))}>Budget<span className="muted">G B</span></Command.Item>
          <Command.Item onSelect={() => go(() => navigate('/accounts'))}>Accounts<span className="muted">G A</span></Command.Item>
          <Command.Item onSelect={() => go(() => navigate('/transactions'))}>Transactions<span className="muted">G T</span></Command.Item>
          <Command.Item onSelect={() => go(() => navigate('/reports'))}>Reports<span className="muted">G R</span></Command.Item>
          <Command.Item onSelect={() => go(() => navigate('/scheduled'))}>Scheduled<span className="muted">G S</span></Command.Item>
          <Command.Item onSelect={() => go(() => navigate('/settings'))}>Settings</Command.Item>
        </Command.Group>
        <Command.Group heading="Accounts">
          {openAccounts.map((a) => (
            <Command.Item key={a.id} value={`account ${a.name}`} onSelect={() => go(() => navigate(`/accounts/${a.id}`))}>
              {a.name}<span className="muted">{money(a.balance, a.currency)}</span>
            </Command.Item>
          ))}
        </Command.Group>
        <Command.Group heading="Categories">
          {categories.filter((c) => !c.hidden).map((c) => (
            <Command.Item key={c.id} value={`category ${c.name} ${c.group.name}`} onSelect={() => go(() => navigate(`/transactions?category=${c.id}`))}>
              {c.name}<span className="muted">{c.group.name}</span>
            </Command.Item>
          ))}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
