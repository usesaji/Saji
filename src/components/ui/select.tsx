"use client";

import * as React from "react";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils/index";

type SelectItemData = { value: string; label: React.ReactNode };

type SelectContextValue = {
	value: string | null;
	onValueChange?: (value: string) => void;
	open: boolean;
	setOpen: (open: boolean) => void;
	placeholder?: string;
	setPlaceholder: (placeholder: string) => void;
	items: SelectItemData[];
	registerItem: (item: SelectItemData) => void;
	triggerRef: React.RefObject<HTMLButtonElement | null>;
	highlightedIndex: number;
	setHighlightedIndex: (i: number) => void;
};

const SelectContext = React.createContext<SelectContextValue | null>(null);

function useSelectContext(component: string) {
	const ctx = React.useContext(SelectContext);
	if (!ctx) {
		throw new Error(`${component} must be used within <Select>`);
	}
	return ctx;
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

interface SelectProps {
	items?: SelectItemData[];
	value?: string | null;
	defaultValue?: string | null;
	onValueChange?: (value: string) => void;
	children: React.ReactNode;
	className?: string;
}

function Select({
	items: itemsProp,
	value: valueProp,
	defaultValue = null,
	onValueChange,
	children,
	className,
}: SelectProps) {
	const [open, setOpen] = React.useState(false);
	const [internalValue, setInternalValue] = React.useState<string | null>(
		defaultValue,
	);
	const [placeholder, setPlaceholder] = React.useState<string | undefined>(
		undefined,
	);
	const [items, setItems] = React.useState<SelectItemData[]>(itemsProp ?? []);
	const [highlightedIndex, setHighlightedIndex] = React.useState(-1);
	const rootRef = React.useRef<HTMLDivElement>(null);
	const triggerRef = React.useRef<HTMLButtonElement>(null);

	const isControlled = valueProp !== undefined;
	const value = isControlled ? valueProp : internalValue;

	const registerItem = React.useCallback((item: SelectItemData) => {
		setItems((prev) => {
			if (prev.some((p) => p.value === item.value)) return prev;
			return [...prev, item];
		});
	}, []);

	const handleValueChange = React.useCallback(
		(next: string) => {
			if (!isControlled) setInternalValue(next);
			onValueChange?.(next);
			setOpen(false);
		},
		[isControlled, onValueChange],
	);

	// Close on outside click / Escape
	React.useEffect(() => {
		if (!open) return;

		function handlePointerDown(e: MouseEvent) {
			if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
				setOpen(false);
			}
		}
		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape") setOpen(false);
		}

		document.addEventListener("mousedown", handlePointerDown);
		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("mousedown", handlePointerDown);
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [open]);

	return (
		<SelectContext.Provider
			value={{
				value,
				onValueChange: handleValueChange,
				open,
				setOpen,
				placeholder,
				setPlaceholder,
				items,
				registerItem,
				triggerRef,
				highlightedIndex,
				setHighlightedIndex,
			}}
		>
			<div
				ref={rootRef}
				data-slot="select"
				className={cn("relative inline-block", className)}
			>
				{children}
			</div>
		</SelectContext.Provider>
	);
}

// ---------------------------------------------------------------------------
// Trigger
// ---------------------------------------------------------------------------

interface SelectTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	size?: "sm" | "default";
}

function SelectTrigger({
	className,
	size = "default",
	children,
	...props
}: SelectTriggerProps) {
	const {
		open,
		setOpen,
		triggerRef,
		items,
		highlightedIndex,
		setHighlightedIndex,
		onValueChange,
	} = useSelectContext("SelectTrigger");

	function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
		if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			if (!open) {
				setOpen(true);
				setHighlightedIndex(0);
			} else if (e.key === "Enter" && highlightedIndex >= 0) {
				onValueChange?.(items[highlightedIndex].value);
			}
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			if (!open) {
				setOpen(true);
				setHighlightedIndex(items.length - 1);
			}
		}
	}

	return (
		<button
			ref={triggerRef}
			type="button"
			data-slot="select-trigger"
			data-size={size}
			aria-haspopup="listbox"
			aria-expanded={open}
			onClick={() => setOpen(!open)}
			onKeyDown={handleKeyDown}
			className={cn(
				"flex w-fit items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-8 data-[size=sm]:h-7 dark:bg-input/30 dark:hover:bg-input/50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				className,
			)}
			{...props}
		>
			{children}
			<ChevronDownIcon
				className={cn(
					"pointer-events-none size-4 text-muted-foreground transition-transform",
					open && "rotate-180",
				)}
			/>
		</button>
	);
}

// ---------------------------------------------------------------------------
// Value
// ---------------------------------------------------------------------------

interface SelectValueProps {
	placeholder?: string;
	className?: string;
}

function SelectValue({ placeholder, className }: SelectValueProps) {
	const { value, items, setPlaceholder } = useSelectContext("SelectValue");

	React.useEffect(() => {
		if (placeholder) setPlaceholder(placeholder);
	}, [placeholder, setPlaceholder]);

	const selected = items.find((i) => i.value === value);

	return (
		<span
			data-slot="select-value"
			className={cn(
				"flex flex-1 text-left",
				!selected && "text-muted-foreground",
				className,
			)}
		>
			{selected ? selected.label : placeholder}
		</span>
	);
}

// ---------------------------------------------------------------------------
// Content (renders inline, absolutely positioned — no portal, no scroll lock)
// ---------------------------------------------------------------------------

interface SelectContentProps {
	className?: string;
	children: React.ReactNode;
	align?: "start" | "center" | "end";
}

function SelectContent({
	className,
	children,
	align = "start",
}: SelectContentProps) {
	const { open } = useSelectContext("SelectContent");

	if (!open) return null;

	return (
		<div
			data-slot="select-content"
			role="listbox"
			className={cn(
				"absolute z-50 mt-1 max-h-64 min-w-36 w-max overflow-y-auto rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 animate-in fade-in-0 zoom-in-95 bg-white",
				align === "start" && "left-0",
				align === "end" && "right-0",
				align === "center" && "left-1/2 -translate-x-1/2",
				className,
			)}
		>
			{children}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Group / Label / Separator (layout only)
// ---------------------------------------------------------------------------

function SelectGroup({
	className,
	children,
}: {
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<div data-slot="select-group" className={cn("scroll-my-1 p-1", className)}>
			{children}
		</div>
	);
}

function SelectLabel({
	className,
	children,
}: {
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<div
			data-slot="select-label"
			className={cn("px-1.5 py-1 text-xs text-muted-foreground", className)}
		>
			{children}
		</div>
	);
}

function SelectSeparator({ className }: { className?: string }) {
	return (
		<div
			data-slot="select-separator"
			className={cn("-mx-1 my-1 h-px bg-border", className)}
		/>
	);
}

// ---------------------------------------------------------------------------
// Item
// ---------------------------------------------------------------------------

interface SelectItemProps {
	value: string;
	children: React.ReactNode;
	className?: string;
	disabled?: boolean;
}

function SelectItem({ value, children, className, disabled }: SelectItemProps) {
	const {
		value: selectedValue,
		onValueChange,
		registerItem,
	} = useSelectContext("SelectItem");

	React.useEffect(() => {
		registerItem({ value, label: children });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [value]);

	const isSelected = selectedValue === value;

	return (
		<div
			data-slot="select-item"
			role="option"
			aria-selected={isSelected}
			aria-disabled={disabled}
			onClick={() => !disabled && onValueChange?.(value)}
			className={cn(
				"relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground",
				disabled && "pointer-events-none opacity-50",
				className,
			)}
		>
			<span className="flex flex-1 shrink-0 gap-2 whitespace-nowrap">
				{children}
			</span>
			{isSelected && (
				<span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
					<CheckIcon className="size-4" />
				</span>
			)}
		</div>
	);
}

export {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectSeparator,
	SelectTrigger,
	SelectValue,
};
