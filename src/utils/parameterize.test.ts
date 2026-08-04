import { describe, expect, it } from 'vitest';
import { parameterizeConfig } from './parameterize.js';

describe('parameterizeConfig', () => {
  it('preserves configuration values while parameterizing portable paths', () => {
    const input = {
      auth: { accessToken: 'real-token', nested: [{ apiKey: 'real-key' }] },
      command: 'C:\\Users\\测试 用户\\bin\\tool.exe',
    };

    expect(parameterizeConfig(input, {
      homeDir: 'C:\\Users\\测试 用户',
      platform: 'win32',
      env: {},
    })).toEqual({
      value: {
        auth: { accessToken: 'real-token', nested: [{ apiKey: 'real-key' }] },
        command: '${HOME}\\bin\\tool.exe',
      },
      parameterizedPathCount: 1,
    });
  });

  it('parameterizes home and configured absolute paths only', () => {
    expect(parameterizeConfig({
      homeSkill: '/Users/测试 用户/.claude/skills/example',
      project: '/Volumes/工作盘/Code/example',
      tool: '/opt/local/bin/tool',
      tools: ['/opt/a/tool', '/opt/b/tool'],
    }, {
      homeDir: '/Users/测试 用户',
      platform: 'darwin',
      env: {},
      variables: { PROJECTS_HOME: '/Volumes/工作盘/Code' },
    })).toEqual({
      value: {
        homeSkill: '${HOME}/.claude/skills/example',
        project: '${PROJECTS_HOME}/example',
        tool: '/opt/local/bin/tool',
        tools: ['/opt/a/tool', '/opt/b/tool'],
      },
      parameterizedPathCount: 2,
    });
  });
});
