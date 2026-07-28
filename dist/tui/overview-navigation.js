export const PRIMARY_DESTINATIONS = [
    { id: 'overview', label: 'Overview' },
    { id: 'capture', label: 'Capture', accelerator: 'c' },
    { id: 'deploy', label: 'Deploy', accelerator: 'd' },
    { id: 'restore', label: 'Restore Latest Deployment', accelerator: 's' },
    { id: 'repository', label: 'Repository', accelerator: 'r' },
    { id: 'help', label: 'Help', accelerator: 'h' },
];
export const PRIMARY_DESTINATION_IDS = PRIMARY_DESTINATIONS.map((destination) => destination.id);
export function primaryDestinationIdForAccelerator(input) {
    return PRIMARY_DESTINATIONS.find((destination) => 'accelerator' in destination && destination.accelerator === input)?.id;
}
