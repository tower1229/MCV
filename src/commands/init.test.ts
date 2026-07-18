import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { initRepository } from './init';
import * as stateUtils from '../utils/state';

// Mock fs and state modules
vi.mock('fs');
vi.mock('../utils/state');

describe('initRepository', () => {
  const targetDir = '/mock/dir';

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should not initialize if mcv.yaml already exists', () => {
    // Mock fs.existsSync to return true
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    initRepository(targetDir);

    expect(fs.existsSync).toHaveBeenCalledWith(path.join(targetDir, 'mcv.yaml'));
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith('An mcv.yaml manifest already exists in this directory.');
    
    consoleSpy.mockRestore();
  });

  it('should initialize repository, create mcv.yaml and update state', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    
    const mockState = {};
    vi.spyOn(stateUtils, 'readState').mockReturnValue(mockState);
    const writeStateSpy = vi.spyOn(stateUtils, 'writeState').mockImplementation(() => {});
    
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    initRepository(targetDir);

    // Verify fs.writeFileSync was called with the correct path and yaml content
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    const [writtenPath, writtenContent] = vi.mocked(fs.writeFileSync).mock.calls[0];
    
    expect(writtenPath).toBe(path.join(targetDir, 'mcv.yaml'));
    expect(writtenContent).toContain('schemaVersion: 1');
    expect(writtenContent).toContain('id: ');
    expect(writtenContent).toContain('initializedAt: ');

    // Verify state was updated and saved
    expect(stateUtils.readState).toHaveBeenCalled();
    expect(writeStateSpy).toHaveBeenCalledTimes(1);
    const writtenState = writeStateSpy.mock.calls[0][0];
    
    expect(writtenState.defaultRepository).toBeDefined();
    expect(writtenState.defaultRepository?.path).toBe(targetDir);
    expect(writtenState.defaultRepository?.id).toBeTruthy();

    consoleSpy.mockRestore();
  });
});
