import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function RemovedLinesBar(props: {
  lineCount: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const lines = props.lineCount === 1 ? "1 removed line" : `${props.lineCount} removed lines`;
  const label = props.expanded ? `Hide ${lines}` : `Show ${lines}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            aria-expanded={props.expanded}
            className="block h-1.5 w-full cursor-pointer bg-destructive/30 transition-colors outline-none hover:bg-destructive/60 focus-visible:bg-destructive/60"
            onClick={props.onToggle}
          />
        }
      />
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}
