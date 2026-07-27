import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import type { EnvironmentReport } from '../operations/environment.js';
import type { StatusReport } from '../operations/status.js';
import type { ShellState } from './shell-state.js';

export interface ShellViewProps {
  state: ShellState;
}

export function ShellView({ state }: ShellViewProps): ReactNode {
  const { page } = state;
  const title = page.route === 'overview' ? 'Overview' : 'Environment Details';

  return (
    <Box flexDirection="column">
      <Text bold>MCV</Text>
      <Text>{title}</Text>
      <Text> </Text>
      {page.status === 'loading' && <Text>Loading {title}...</Text>}
      {page.status === 'failure' && <Text color="red">Failed: {page.message}</Text>}
      {page.status === 'ready' && page.route === 'overview' && (
        <Overview report={page.report} />
      )}
      {page.status === 'ready' && page.route === 'environment' && (
        <EnvironmentDetails report={page.report} />
      )}
      <Text> </Text>
      <Text dimColor>
        {page.route === 'overview'
          ? 'e Environment Details   q Quit   Ctrl+C Cancel'
          : 'Escape Overview   q Quit   Ctrl+C Cancel'}
      </Text>
    </Box>
  );
}

function Overview({ report }: { report: StatusReport }): ReactNode {
  const pending = report.pendingDeployment;
  const local = report.postDeployLocalState;

  return (
    <Box flexDirection="column">
      <Text>Repository: {report.repository.path}</Text>
      {report.repository.git && (
        <Text>
          Git: {report.repository.git.clean
            ? 'clean'
            : `${report.repository.git.uncommittedChanges} uncommitted changes`}
        </Text>
      )}
      <Text>
        Pending deployment: {pending.total} changes ({pending.add} add,{' '}
        {pending.modify} modify, {pending.delete} delete)
      </Text>
      <Text>
        Local managed state: {local.drift} changed, {local.missing} missing
      </Text>
      <Text>
        Environment: {report.environment.missingVariables.length} missing variables
      </Text>
      <Text>IDE support:</Text>
      {report.environment.ideSupport.map((ide) => (
        <Text key={ide.id}>
          {'  '}{ide.name}: {ide.enabled ? 'enabled' : 'disabled'},{' '}
          {ide.detected ? 'detected' : 'not detected'}
        </Text>
      ))}
      <Text>
        Last operation: {report.lastOperation
          ? `${report.lastOperation.kind} · ${report.lastOperation.success ? 'success' : 'failure'}`
          : 'none'}
      </Text>
    </Box>
  );
}

function EnvironmentDetails({ report }: { report: EnvironmentReport }): ReactNode {
  return (
    <Box flexDirection="column">
      {report.environments.map((environment) => (
        <Box key={environment.id} flexDirection="column">
          <Text>
            {environment.name}: {environment.detected ? 'detected' : 'not detected'}
          </Text>
          {[...environment.configDirectories, ...environment.configFiles].map((item) => (
            <Text key={`${environment.id}:${item.path}`}>
              {'  '}[{item.exists ? 'found' : 'missing'}] {item.path}
            </Text>
          ))}
        </Box>
      ))}
      {report.missingVariables.length > 0 && (
        <Text>Missing variables: {report.missingVariables.join(', ')}</Text>
      )}
    </Box>
  );
}
