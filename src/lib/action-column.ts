import { z } from 'zod';

export const ACTION_CHANNELS = ['linkedin', 'instagram', 'facebook', 'email-sequencer', 'agentweb-site'] as const;
export type ActionChannel = (typeof ACTION_CHANNELS)[number];

/** A saved action definition. Saving it configures a column only; it never runs the external action. */
export const ActionColumnSchema = z.object({
	channel: z.enum(ACTION_CHANNELS),
	action: z.string().trim().min(1).max(120),
	instructions: z.string().trim().min(1).max(4000),
	domain: z.string().trim().max(253).optional(),
}).superRefine((value, context) => {
	if (value.channel === 'agentweb-site' && (!value.domain || !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(value.domain))) {
		context.addIssue({ code: 'custom', path: ['domain'], message: 'Enter a valid website domain.' });
	}
});

export type ActionColumnDefinition = z.infer<typeof ActionColumnSchema>;
