let commandSequence = 0;

export function createCommandId(): string {
	commandSequence += 1;
	return `command-${commandSequence}`;
}
