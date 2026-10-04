import {DeepInfraProvider,deepInfraFromEnvironment} from './deepinfra.ts';
import {GeminiProvider,geminiFromEnvironment} from './gemini.ts';

export const directProviderIds=['deepinfra','gemini'] as const;
export type DirectProviderId=typeof directProviderIds[number];
export type DirectProvider=DeepInfraProvider|GeminiProvider;

export function directProvidersFromEnvironment(env:NodeJS.ProcessEnv=process.env):DirectProvider[]{
 const providers:DirectProvider[]=[],deepinfra=deepInfraFromEnvironment(env),gemini=geminiFromEnvironment(env);
 if(deepinfra)providers.push(deepinfra);if(gemini)providers.push(gemini);return providers;
}
export function preferredDirectProvider(providers:DirectProvider[],env:NodeJS.ProcessEnv=process.env){
 const requested=env.AI_PROVIDER?.trim().toLowerCase();
 return providers.find(provider=>provider.id===requested)??providers[0];
}
export function preferredDirectProviderId(providers:DirectProvider[],env:NodeJS.ProcessEnv=process.env):DirectProviderId{
 const requested=env.AI_PROVIDER?.trim().toLowerCase();
 return directProviderIds.includes(requested as DirectProviderId)?requested as DirectProviderId:preferredDirectProvider(providers,env)?.id??'deepinfra';
}
