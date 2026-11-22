import 'server-only';

import type { LanguageModelV4 } from '@ai-sdk/provider';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import type { Decider } from '../types';
import { CredentialError } from './credentials';
import type { ProviderAccess } from './provider-access';

/* Decision columns use only the workspace's user-supplied OpenAI key. */

export interface NoulResult {
	probability: number;
	engine: 'jev' | 'openai';
	model: string;
	reasoning?: string;
}
export interface ChoiceResult {
	choice: string;
	probabilities: Record<string, number>;
	confidence?: number;
	engine: 'jev' | 'openai';
	model: string;
	reasoning?: string;
}
export interface ScoreResult {
	score: number;
	level: string;
	probabilities: Record<string, number>;
	confidence?: number;
	engine: 'jev' | 'openai';
	model: string;
	reasoning?: string;
}

interface OpenAIEngine { model: LanguageModelV4; id: string }

async function decide<T>(access: ProviderAccess, viaOpenAI: (engine: OpenAIEngine) => Promise<T>): Promise<T> {
	if (!access.key('openai')) throw new CredentialError('Add your OpenAI API key in Configuration to use reasoning columns.', 401, 'credential_missing', 'openai');
	const id = access.classifierModel ?? access.model;
	return viaOpenAI({ model: access.openai(id), id });
}

export function decideNoul(access: ProviderAccess, _requested: Decider, state: string, question: string): Promise<NoulResult> {
	return decide<NoulResult>(access, (engine) => noulWithOpenAI(engine, state, question));
}

async function noulWithOpenAI(engine: OpenAIEngine, state: string, question: string): Promise<NoulResult> {
	const { output } = await generateText({
		model: engine.model,
		output: Output.object({ schema: z.object({ reasoning: z.string().describe('One or two sentences of evidence.'), probability: z.number().min(0).max(1).describe('Probability that the answer to the question is yes.') }) }),
		system: 'You judge a single true/false question against the provided state. Use only the state; if the state lacks evidence, give a probability near 0.5 and say so.',
		prompt: `STATE:\n${state.slice(0, 80_000)}\n\nQUESTION: ${question}`,
		maxRetries: 0,
	});
	return { probability: output.probability, engine: 'openai', model: engine.id, reasoning: output.reasoning };
}

export function decideChoice(access: ProviderAccess, _requested: Decider, state: string, question: string, options: Array<{ label: string; description?: string }>): Promise<ChoiceResult> {
	return decide<ChoiceResult>(access, (engine) => choiceWithOpenAI(engine, state, question, options));
}

async function choiceWithOpenAI(engine: OpenAIEngine, state: string, question: string, options: Array<{ label: string; description?: string }>): Promise<ChoiceResult> {
	const labels = options.map((option) => option.label);
	const { output } = await generateText({
		model: engine.model,
		output: Output.object({
			schema: z.object({
				reasoning: z.string(),
				choice: z.enum(labels as [string, ...string[]]),
				confidence: z.number().min(0).max(1),
			}),
		}),
		system: 'Pick exactly one option that best answers the question about the state. Use only the state.',
		prompt: `STATE:\n${state.slice(0, 80_000)}\n\nQUESTION: ${question}\n\nOPTIONS:\n${options.map((o) => `- ${o.label}${o.description ? `: ${o.description}` : ''}`).join('\n')}`,
		maxRetries: 0,
	});
	const probabilities: Record<string, number> = {};
	for (const label of labels) probabilities[label] = label === output.choice ? output.confidence : (1 - output.confidence) / Math.max(1, labels.length - 1);
	return { choice: output.choice, probabilities, confidence: output.confidence, engine: 'openai', model: engine.id, reasoning: output.reasoning };
}

export function decideScore(access: ProviderAccess, _requested: Decider, state: string, question: string, levels: string[]): Promise<ScoreResult> {
	return decide<ScoreResult>(access, (engine) => scoreWithOpenAI(engine, state, question, levels));
}

async function scoreWithOpenAI(engine: OpenAIEngine, state: string, question: string, levels: string[]): Promise<ScoreResult> {
	const { output } = await generateText({
		model: engine.model,
		output: Output.object({ schema: z.object({ reasoning: z.string(), level: z.number().int().min(0).max(levels.length - 1), confidence: z.number().min(0).max(1) }) }),
		system: 'Rate the state against the ordered levels (0 is the first level). Use only the state.',
		prompt: `STATE:\n${state.slice(0, 80_000)}\n\nQUESTION: ${question}\n\nLEVELS:\n${levels.map((level, index) => `${index}: ${level}`).join('\n')}`,
		maxRetries: 0,
	});
	const probabilities: Record<string, number> = {};
	levels.forEach((level, index) => {
		probabilities[level] = index === output.level ? output.confidence : (1 - output.confidence) / Math.max(1, levels.length - 1);
	});
	return { score: output.level, level: levels[output.level], probabilities, confidence: output.confidence, engine: 'openai', model: engine.id, reasoning: output.reasoning };
}
