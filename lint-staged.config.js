export default {
	'*.{ts,js}': (stagedFiles) => [`prettier --list-different ${stagedFiles.join(' ')}`, `eslint ${stagedFiles.join(' ')}`],
	'*.md': (stagedFiles) => `prettier --list-different ${stagedFiles.join(' ')}`,
};
