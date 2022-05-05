import { useAppContext } from "./bootstrap";

export interface ContractContext {
  address?: string;
}

export type ContractFunctionParams = Record<string, unknown>;

export type ContractFunction = (
  context: ContractContext,
  params: ContractFunctionParams
) => Record<string, Record<string, unknown>>;

export interface ContractDefinition {
  messages?: Record<string, ContractFunction>;
  queries?: Record<string, ContractFunction>;
}

export type ContractProxyTarget = Record<string, ContractFunction>;

export interface ContractExecutionOptions {
  fee: number;
}

export type BaseContract = {
  at: string;
};

/**
 * A type helper for defining a contract.
 * @param definition A contract definition
 * @returns A contract definition
 */
export function defineContract(
  definition: ContractDefinition
): ContractDefinition {
  const messagesKeys = Object.keys(definition.messages || {});
  const queriesKeys = Object.keys(definition.queries || {});

  const match = messagesKeys.find(it => queriesKeys.includes(it));
  if (match)
    throw new Error(
      `Could not define contract: name collision for function ${match}`
    );

  return definition;
}

/**
 * Extends `base` contract definition with `extension`.
 * @param base - contract definition to extend
 * @param extension - contract definition to extend from
 * @returns a newly extended contract definition
 */
export function extendContractDefinition(
  base: ContractDefinition,
  extension: ContractDefinition
): ContractDefinition {
  const messages = getContractFunctions(
    base.messages,
    extension.messages
  ) as Record<string, ContractFunction>;
  const queries = getContractFunctions(
    base.queries,
    extension.queries
  ) as Record<string, ContractFunction>;
  return defineContract({
    messages,
    queries
  });
}

function getContractFunctions(
  baseFunctions: Record<string, ContractFunction> = {},
  extensionFunctions: Record<string, ContractFunction> = {}
): Record<string, ContractFunction> {
  const baseNames = Object.keys(baseFunctions);
  const extensionNames = Object.keys(extensionFunctions);

  const functions: Record<string, ContractFunction> = {};

  for (const name of baseNames) {
    functions[name] = baseFunctions[name];
  }

  for (const name of extensionNames) {
    functions[name] = extensionFunctions[name];
  }

  return functions;
}

/**
 * Creates a contract client.
 * @param at contract address to point to
 * @param definition contract definition
 * @returns a contract client
 */
export function createContractClient<T extends BaseContract>(
  at: string,
  definition: ContractDefinition
): T {
  const messages = definition.messages || {};
  const queries = definition.queries || {};

  const target = {
    ...queries,
    ...messages
  };

  const proxy = new Proxy<ContractProxyTarget>(target, {
    get(def, prop) {
      if (prop === "at") {
        return at;
      }

      const isQuery = () => Object.keys(queries).includes(prop as string);
      const isMessage = () => !isQuery();

      return new Proxy<ContractFunction>(def[prop as string], {
        apply(fun, thisArg, argArray) {
          const context = getContractContext();
          const args = [context, argArray[0]];
          const msg = Reflect.apply(fun, thisArg, args);

          const { client, signingClient } = useAppContext();

          if (isQuery()) {
            return client.queryContractSmart(at, msg);
          } else if (isMessage()) {
            if (!context.address) throw new Error("No address available");

            return signingClient?.execute(context.address, at, msg, "auto");
          }
        }
      });
    }
  });

  return proxy as unknown as T;
}

function getContractContext(): ContractContext {
  const { account } = useAppContext();
  return { address: account?.address };
}
