import "./Tabs.css";

interface TabsProps<T extends string> {
  tabs: { value: T; label: string }[];
  active: T;
  onChange: (value: T) => void;
  small?: boolean;
}

export default function Tabs<T extends string>({ tabs, active, onChange, small }: TabsProps<T>) {
  return (
    <div className={"tabs" + (small ? " tabs--small" : "")} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={tab.value === active}
          className={"tabs__item" + (tab.value === active ? " tabs__item--active" : "")}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
