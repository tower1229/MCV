import { describe, expect, it } from 'vitest';
import { isSensitiveFile, sanitizeConfig } from './sanitize';

describe('sanitizeConfig', () => {
  it('replaces sensitive fields and home paths with portable references', () => {
    const input = {
      auth: {
        accessToken: 'real-token',
        nested: [{ apiKey: 'real-key' }],
      },
      command: 'C:\\Users\\测试 用户\\bin\\tool.exe',
    };

    expect(
      sanitizeConfig(input, {
        homeDir: 'C:\\Users\\测试 用户',
        platform: 'win32',
      }),
    ).toEqual({
      value: {
        auth: {
          accessToken: '${env:ACCESS_TOKEN}',
          nested: [{ apiKey: '${env:API_KEY}' }],
        },
        command: '${HOME}\\bin\\tool.exe',
      },
      sensitiveFieldCount: 2,
      parameterizedPathCount: 1,
    });
  });

  it('blacklists common credential file names before reading them', () => {
    expect(isSensitiveFile('/home/user/.env.local')).toBe(true);
    expect(isSensitiveFile('/home/user/credentials.yaml')).toBe(true);
    expect(isSensitiveFile('/home/user/client.pem')).toBe(true);
    expect(isSensitiveFile('/home/user/settings.json')).toBe(false);
  });

  it('parameterizes Unix home and configured absolute paths', () => {
    expect(
      sanitizeConfig(
        {
          homeSkill: '/Users/测试 用户/.claude/skills/example',
          project: '/Volumes/工作盘/Code/example',
          tool: '/opt/local/bin/tool',
          tools: ['/opt/a/tool', '/opt/b/tool'],
        },
        {
          homeDir: '/Users/测试 用户',
          platform: 'darwin',
          variables: { PROJECTS_HOME: '/Volumes/工作盘/Code' },
        },
      ),
    ).toEqual({
      value: {
        homeSkill: '${HOME}/.claude/skills/example',
        project: '${PROJECTS_HOME}/example',
        tool: '${env:MCV_TOOL_PATH_746F6F6C}',
        tools: [
          '${env:MCV_TOOLS_0_PATH_746F6F6C73_30}',
          '${env:MCV_TOOLS_1_PATH_746F6F6C73_31}',
        ],
      },
      sensitiveFieldCount: 0,
      parameterizedPathCount: 5,
    });
  });

  it('generates distinct fallback variables for paths whose readable names collide', () => {
    const result = sanitizeConfig(
      {
        a_b: { c: '/opt/first' },
        a: { b_c: '/opt/second' },
      },
      { homeDir: '/Users/example', platform: 'darwin' },
    );

    expect(result.value.a_b.c).not.toBe(result.value.a.b_c);
  });
});
