export const ATLAS_TACTICS = [
  'Reconnaissance',
  'ML Model Access',
  'Execution',
  'Privilege Escalation',
  'Persistence',
  'Exfiltration',
  'Poison Training Data',
  'Invert/Infer Model',
  'Denial of Service',
  'Evade ML Model',
  'Adversarial Attack',
  'External Harms',
  'Prompt Injection',
  'LLM Jailbreak',
  'Plugin Compromise',
  'Exfiltration via Tool',
] as const;

export const ATLAS_LEGACY_TACTICS = [
  'Defense Evasion',
  'Discovery',
  'Initial Access',
] as const;

export const ATLAS_TACTIC_VALUES = [
  ...ATLAS_TACTICS,
  ...ATLAS_LEGACY_TACTICS,
] as const;

export type AtlasTactic = typeof ATLAS_TACTIC_VALUES[number];

export const ATLAS_TECHNIQUE_IDS = [
  'TA0000',
  'TA0004',
  'TA0005',
  'TA0006',
  'TA0007',
  'TA0009',
  'T0020',
  'T0024',
  'T0029',
  'T0031',
  'T0043',
  'T0048',
  'T0051',
  'T0054',
  'T0055',
  'T0058',
] as const;

export const ATLAS_LEGACY_TECHNIQUE_IDS = [
  'AML.T0056',
  'AML.T0068',
  'AML.T0069.002',
  'AML.T0081',
  'AML.T0084.001',
  'AML.T0086',
  'AML.T0093',
  'AML.T0110',
] as const;

export const ATLAS_TECHNIQUE_ID_VALUES = [
  ...ATLAS_TECHNIQUE_IDS,
  ...ATLAS_LEGACY_TECHNIQUE_IDS,
] as const;

export type AtlasTechniqueId = typeof ATLAS_TECHNIQUE_ID_VALUES[number];

export const LOCAL_ARCHETYPES = [
  'api_enumeration',
  'tool_enumeration',
  'model_fingerprinting',
  'api_input_vector',
  'api_query_stealing',
  'attack_external_internal_systems',
  'code_execution',
  'malicious_workflows',
  'fraudulent_use',
  'unauthorized_access',
  'token_manipulation',
  'protocol_manipulation',
  'memory_system_persistence',
  'config_persistence',
  'replay_exploitation',
  'data_info_disclosure',
  'attack_external_internal_users',
  'eavesdropping',
  'data_poisoning',
  'reinforcement_biasing',
  'backdoors_trojans',
  'test_bias',
  'inversion',
  'cot_introspection',
  'model_extraction',
  'dos_intent',
  'cognitive_overload',
  'environment_aware_evasion',
  'truncation_misspell',
  'synonyms',
  'gradient_attacks',
  'unauth_professional_advice',
  'business_integrity',
  'discuss_harm',
  'prompt_injection',
  'jailbreak',
  'plugin_compromise',
  'tool_exfiltration',
  'instruction_override',
  'roleplay_jailbreak',
  'encoding_obfuscation',
  'system_prompt_discovery',
  'system_prompt_exfiltration',
  'tool_discovery',
  'tool_agent_exploitation',
  'agent_config_tampering',
  'tool_poisoning',
  'indirect_policy_evasion',
] as const;

export type LocalArchetype = typeof LOCAL_ARCHETYPES[number];

export interface AtlasTaxonomyFields {
  atlasTactic?: AtlasTactic;
  atlasTechniqueId?: AtlasTechniqueId;
  atlasTechniqueName?: string;
  localArchetype?: LocalArchetype;
  taxonomyConfidence?: number;
  taxonomyNotes?: string;
}

export interface AtlasTechniqueDefinition {
  tactic: AtlasTactic;
  id: AtlasTechniqueId;
  name: string;
  mappedCategories?: string[];
  legacy?: boolean;
}

export const ATLAS_TECHNIQUE_DEFINITIONS: AtlasTechniqueDefinition[] = [
  {
    tactic: 'Reconnaissance',
    id: 'TA0000',
    name: 'Reconnaissance',
    mappedCategories: ['API Enumeration', 'Tool Enumeration', 'Model Fingerprinting'],
  },
  {
    tactic: 'ML Model Access',
    id: 'TA0004',
    name: 'ML Model Access',
    mappedCategories: ['API Request input vector', 'API Query Stealing'],
  },
  {
    tactic: 'Execution',
    id: 'TA0005',
    name: 'Execution',
    mappedCategories: ['Attack External/Internal Systems', 'Code Execution', 'Malicious Workflows', 'Fraudulent Use'],
  },
  {
    tactic: 'Privilege Escalation',
    id: 'TA0006',
    name: 'Privilege Escalation',
    mappedCategories: ['Unauthorized Access', 'Token Manipulation', 'Protocol Manipulation'],
  },
  {
    tactic: 'Persistence',
    id: 'TA0007',
    name: 'Persistence',
    mappedCategories: ['Memory System Persistence', 'Config Persistence', 'Replay Exploitation'],
  },
  {
    tactic: 'Exfiltration',
    id: 'TA0009',
    name: 'Exfiltration',
    mappedCategories: ['Data/Info Disclosure', 'Attack External/Internal Users', 'Eavesdropping'],
  },
  {
    tactic: 'Poison Training Data',
    id: 'T0020',
    name: 'Poison Training Data',
    mappedCategories: ['Data Poisoning', 'Reinforcement Biasing', 'Backdoors/Trojans'],
  },
  {
    tactic: 'Invert/Infer Model',
    id: 'T0024',
    name: 'Invert/Infer Model',
    mappedCategories: ['Test Bias', 'Inversion', 'CoT Introspection', 'Model Extraction'],
  },
  {
    tactic: 'Denial of Service',
    id: 'T0029',
    name: 'Denial of Service',
    mappedCategories: ['DoS intent', 'Cognitive Overload', 'Disruption subtechniques'],
  },
  {
    tactic: 'Evade ML Model',
    id: 'T0031',
    name: 'Evade ML Model',
    mappedCategories: ['Environment-Aware Evasion', 'Truncation/Misspell', 'Synonyms'],
  },
  {
    tactic: 'Adversarial Attack',
    id: 'T0043',
    name: 'Adversarial Attack',
    mappedCategories: ['Gradient Attacks', 'GCG', 'AutoDAN', 'PAIR', 'TAP'],
  },
  {
    tactic: 'External Harms',
    id: 'T0048',
    name: 'External Harms',
    mappedCategories: ['Unauthorized Professional Advice', 'Business Integrity', 'Discuss Harm', '15.x subtechniques'],
  },
  {
    tactic: 'Prompt Injection',
    id: 'T0051',
    name: 'Prompt Injection',
    mappedCategories: ['Direct injection', 'Indirect injection', 'Input vectors', 'Encoding evasions'],
  },
  {
    tactic: 'LLM Jailbreak',
    id: 'T0054',
    name: 'LLM Jailbreak',
    mappedCategories: ['Jailbreak', 'CBRNE', 'Narrative Injection', 'Anti-Refusal', 'Priming', 'Bijection'],
  },
  {
    tactic: 'Plugin Compromise',
    id: 'T0055',
    name: 'Plugin Compromise',
    mappedCategories: ['Tool Exploitation', 'Dependency Compromise', 'Fusion Payload Split'],
  },
  {
    tactic: 'Exfiltration via Tool',
    id: 'T0058',
    name: 'Exfiltration via Tool',
    mappedCategories: ['Tool-mediated exfiltration'],
  },
];

export const ATLAS_LEGACY_TECHNIQUE_DEFINITIONS: AtlasTechniqueDefinition[] = [
  { tactic: 'Exfiltration', id: 'AML.T0056', name: 'Extract LLM System Prompt', legacy: true },
  { tactic: 'Defense Evasion', id: 'AML.T0068', name: 'LLM Prompt Obfuscation', legacy: true },
  { tactic: 'Discovery', id: 'AML.T0069.002', name: 'System Prompt', legacy: true },
  { tactic: 'Defense Evasion', id: 'AML.T0081', name: 'Modify AI Agent Configuration', legacy: true },
  { tactic: 'Discovery', id: 'AML.T0084.001', name: 'Tool Definitions', legacy: true },
  { tactic: 'Exfiltration', id: 'AML.T0086', name: 'Exfiltration via AI Agent Tool Invocation', legacy: true },
  { tactic: 'Initial Access', id: 'AML.T0093', name: 'Prompt Infiltration via Public-Facing Application', legacy: true },
  { tactic: 'Persistence', id: 'AML.T0110', name: 'AI Agent Tool Poisoning', legacy: true },
];

export const ATLAS_TECHNIQUE_NAME_BY_ID = new Map<AtlasTechniqueId, string>(
  [...ATLAS_TECHNIQUE_DEFINITIONS, ...ATLAS_LEGACY_TECHNIQUE_DEFINITIONS].map((definition) => [
    definition.id,
    definition.name,
  ]),
);
