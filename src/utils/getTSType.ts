import { namedTypes as t } from 'ast-types';
import getPropertyName from './getPropertyName';
import printValue from './printValue';
import getTypeAnnotation from '../utils/getTypeAnnotation';
import resolveToValue from '../utils/resolveToValue';
import { resolveObjectToNameArray } from '../utils/resolveObjectKeysToArray';
import getTypeParameters, { TypeParameters } from '../utils/getTypeParameters';
import type { Importer } from '../parse';

import type {
  ElementsType,
  FunctionArgumentType,
  LiteralType,
  ObjectSignatureType,
  SimpleType,
  TypeDescriptor,
  TSFunctionSignatureType,
} from '../Documentation';
import { NodePath } from 'ast-types/lib/node-path';

const tsTypes = {
  TSAnyKeyword: 'any',
  TSBooleanKeyword: 'boolean',
  TSUnknownKeyword: 'unknown',
  TSNeverKeyword: 'never',
  TSNullKeyword: 'null',
  TSUndefinedKeyword: 'undefined',
  TSNumberKeyword: 'number',
  TSStringKeyword: 'string',
  TSSymbolKeyword: 'symbol',
  TSThisType: 'this',
  TSObjectKeyword: 'object',
  TSVoidKeyword: 'void',
};

const namedTypes = {
  TSArrayType: handleTSArrayType,
  TSTypeReference: handleTSTypeReference,
  TSTypeLiteral: handleTSTypeLiteral,
  TSInterfaceDeclaration: handleTSInterfaceDeclaration,
  TSUnionType: handleTSUnionType,
  TSFunctionType: handleTSFunctionType,
  TSIntersectionType: handleTSIntersectionType,
  TSMappedType: handleTSMappedType,
  TSTupleType: handleTSTupleType,
  TSTypeQuery: handleTSTypeQuery,
  TSTypeOperator: handleTSTypeOperator,
  TSIndexedAccessType: handleTSIndexedAccessType,
};

function handleTSArrayType(
  path: NodePath,
  typeParams: TypeParameters | null,
  importer: Importer,
): ElementsType<TSFunctionSignatureType> {
  return {
    name: 'Array',
    elements: [
      getTSTypeWithResolvedTypes(path.get('elementType'), typeParams, importer),
    ],
    raw: printValue(path),
  };
}

function handleTSTypeReference(
  path: NodePath,
  typeParams: TypeParameters,
  importer: Importer,
): TypeDescriptor<TSFunctionSignatureType> | null {
  let type: TypeDescriptor<TSFunctionSignatureType>;
  if (t.TSQualifiedName.check(path.node.typeName)) {
    const typeName = path.get('typeName');

    if (typeName.node.left.name === 'React') {
      type = {
        name: `${typeName.node.left.name}${typeName.node.right.name}`,
        raw: printValue(typeName),
      };
    } else {
      type = { name: printValue(typeName).replace(/<.*>$/, '') };
    }
  } else {
    type = { name: path.node.typeName.name };
  }

  const resolvedPath =
    (typeParams && typeParams[type.name]) ||
    resolveToValue(path.get('typeName'), importer);

  if (path.node.typeParameters && resolvedPath.node.typeParameters) {
    typeParams = getTypeParameters(
      resolvedPath.get('typeParameters'),
      path.get('typeParameters'),
      typeParams,
      importer,
    );
  }

  if (typeParams && typeParams[type.name]) {
    // Open question: Why is this `null` instead of `typeParams`
    type = getTSTypeWithResolvedTypes(resolvedPath, null, importer);
  }

  if (resolvedPath && resolvedPath.node.typeAnnotation) {
    type = getTSTypeWithResolvedTypes(
      resolvedPath.get('typeAnnotation'),
      typeParams,
      importer,
    );
  } else if (path.node.typeParameters) {
    const params = path.get('typeParameters').get('params');

    type = {
      ...(type as SimpleType),
      elements: params.map((param: NodePath) =>
        getTSTypeWithResolvedTypes(param, typeParams, importer),
      ),
      raw: printValue(path),
    };
  }

  return type;
}

function getTSTypeWithRequirements(
  path: NodePath,
  typeParams: TypeParameters | null,
  importer: Importer,
): TypeDescriptor<TSFunctionSignatureType> {
  const type = getTSTypeWithResolvedTypes(path, typeParams, importer);
  type.required = !path.parentPath.node.optional;
  return type;
}

function handleTSTypeLiteral(
  path: NodePath,
  typeParams: TypeParameters | null,
  importer: Importer,
): ObjectSignatureType<TSFunctionSignatureType> {
  const type: ObjectSignatureType<TSFunctionSignatureType> = {
    name: 'signature',
    type: 'object',
    raw: printValue(path),
    signature: { properties: [] },
  };

  path.get('members').each(param => {
    if (
      t.TSPropertySignature.check(param.node) ||
      t.TSMethodSignature.check(param.node)
    ) {
      const propName = getPropertyName(param, importer);
      if (!propName) {
        return;
      }
      type.signature.properties.push({
        key: propName,
        value: getTSTypeWithRequirements(
          param.get('typeAnnotation'),
          typeParams,
          importer,
        ),
      });
    } else if (t.TSCallSignatureDeclaration.check(param.node)) {
      type.signature.constructor = handleTSFunctionType(
        param,
        typeParams,
        importer,
      );
    } else if (t.TSIndexSignature.check(param.node)) {
      type.signature.properties.push({
        key: getTSTypeWithResolvedTypes(
          param.get('parameters').get(0).get('typeAnnotation'),
          typeParams,
          importer,
        ),
        value: getTSTypeWithRequirements(
          param.get('typeAnnotation'),
          typeParams,
          importer,
        ),
      });
    }
  });

  return type;
}

function handleTSInterfaceDeclaration(path: NodePath): SimpleType {
  // Interfaces are handled like references which would be documented separately,
  // rather than inlined like type aliases.
  return {
    name: path.node.id.name,
  };
}

function handleTSUnionType(
  path: NodePath,
  typeParams: TypeParameters | null,
  importer: Importer,
): ElementsType<TSFunctionSignatureType> {
  return {
    name: 'union',
    raw: printValue(path),
    elements: path
      .get('types')
      .map(subType =>
        getTSTypeWithResolvedTypes(subType, typeParams, importer),
      ),
  };
}

function handleTSIntersectionType(
  path: NodePath,
  typeParams: TypeParameters | null,
  importer: Importer,
): ElementsType<TSFunctionSignatureType> {
  return {
    name: 'intersection',
    raw: printValue(path),
    elements: path
      .get('types')
      .map(subType =>
        getTSTypeWithResolvedTypes(subType, typeParams, importer),
      ),
  };
}

function handleTSMappedType(
  path: NodePath,
  typeParams: TypeParameters | null,
  importer: Importer,
): ObjectSignatureType<TSFunctionSignatureType> {
  const key = getTSTypeWithResolvedTypes(
    path.get('typeParameter').get('constraint'),
    typeParams,
    importer,
  );
  key.required = !path.node.optional;

  return {
    name: 'signature',
    type: 'object',
    raw: printValue(path),
    signature: {
      properties: [
        {
          key,
          value: getTSTypeWithResolvedTypes(
            path.get('typeAnnotation'),
            typeParams,
            importer,
          ),
        },
      ],
    },
  };
}

function handleTSFunctionType(
  path: NodePath,
  typeParams: TypeParameters | null,
  importer: Importer,
): TSFunctionSignatureType {
  const type: TSFunctionSignatureType = {
    name: 'signature',
    type: 'function',
    raw: printValue(path),
    signature: {
      arguments: [],
      return: getTSTypeWithResolvedTypes(
        path.get('typeAnnotation'),
        typeParams,
        importer,
      ),
    },
  };

  path.get('parameters').each(param => {
    const typeAnnotation = getTypeAnnotation(param);
    const arg: FunctionArgumentType<TSFunctionSignatureType> = {
      name: param.node.name || '',
      type: typeAnnotation
        ? getTSTypeWithResolvedTypes(typeAnnotation, typeParams, importer)
        : undefined,
    };

    if (param.node.name === 'this') {
      type.signature.this = arg.type;
      return;
    }

    if (param.node.type === 'RestElement') {
      arg.name = param.node.argument.name;
      arg.rest = true;
    }

    type.signature.arguments.push(arg);
  });

  return type;
}

function handleTSTupleType(
  path: NodePath,
  typeParams: TypeParameters | null,
  importer: Importer,
): ElementsType<TSFunctionSignatureType> {
  const type: ElementsType<TSFunctionSignatureType> = {
    name: 'tuple',
    raw: printValue(path),
    elements: [],
  };

  path.get('elementTypes').each(param => {
    type.elements.push(getTSTypeWithResolvedTypes(param, typeParams, importer));
  });

  return type;
}

function handleTSTypeQuery(
  path: NodePath,
  typeParams: TypeParameters | null,
  importer: Importer,
): TypeDescriptor<TSFunctionSignatureType> {
  const resolvedPath = resolveToValue(path.get('exprName'), importer);
  if (resolvedPath && resolvedPath.node.typeAnnotation) {
    return getTSTypeWithResolvedTypes(
      resolvedPath.get('typeAnnotation'),
      typeParams,
      importer,
    );
  }

  return { name: path.node.exprName.name };
}

function handleTSTypeOperator(
  path: NodePath,
  _typeParams: TypeParameters | null,
  importer: Importer,
): TypeDescriptor<TSFunctionSignatureType> | null {
  if (path.node.operator !== 'keyof') {
    return null;
  }

  let value = path.get('typeAnnotation');
  if (t.TSTypeQuery.check(value.node)) {
    value = value.get('exprName');
  } else if (value.node.id) {
    value = value.get('id');
  }

  const resolvedPath = resolveToValue(value, importer);
  if (
    resolvedPath &&
    (t.ObjectExpression.check(resolvedPath.node) ||
      t.TSTypeLiteral.check(resolvedPath.node))
  ) {
    const keys = resolveObjectToNameArray(resolvedPath, importer, true);

    if (keys) {
      return {
        name: 'union',
        raw: printValue(path),
        elements: keys.map(key => ({ name: 'literal', value: key })),
      };
    }
  }

  return null;
}

function handleTSIndexedAccessType(
  path: NodePath,
  typeParams: TypeParameters | null,
  importer: Importer,
): SimpleType {
  const objectType = getTSTypeWithResolvedTypes(
    path.get('objectType'),
    typeParams,
    importer,
  ) as ObjectSignatureType<TSFunctionSignatureType>;
  const indexType = getTSTypeWithResolvedTypes(
    path.get('indexType'),
    typeParams,
    importer,
  ) as LiteralType;

  // We only get the signature if the objectType is a type (vs interface)
  if (!objectType.signature)
    return {
      name: `${objectType.name}[${
        indexType.value ? indexType.value.toString() : indexType.name
      }]`,
      raw: printValue(path),
    };
  const resolvedType = objectType.signature.properties.find(p => {
    // indexType.value = "'foo'"
    return indexType.value && p.key === indexType.value.replace(/['"]+/g, '');
  });
  if (!resolvedType) {
    return { name: 'unknown' };
  }
  return {
    name: resolvedType.value.name,
    raw: printValue(path),
  };
}

let visitedTypes = {};

function getTSTypeWithResolvedTypes(
  path: NodePath,
  typeParams: TypeParameters | null,
  importer: Importer,
): TypeDescriptor<TSFunctionSignatureType> {
  if (t.TSTypeAnnotation.check(path.node)) {
    path = path.get('typeAnnotation');
  }

  const node = path.node;
  let type: TypeDescriptor;
  const isTypeAlias = t.TSTypeAliasDeclaration.check(path.parentPath.node);

  // When we see a typealias mark it as visited so that the next
  // call of this function does not run into an endless loop
  if (isTypeAlias) {
    if (visitedTypes[path.parentPath.node.id.name] === true) {
      // if we are currently visiting this node then just return the name
      // as we are starting to endless loop
      return { name: path.parentPath.node.id.name };
    } else if (typeof visitedTypes[path.parentPath.node.id.name] === 'object') {
      // if we already resolved the type simple return it
      return visitedTypes[path.parentPath.node.id.name];
    }
    // mark the type as visited
    visitedTypes[path.parentPath.node.id.name] = true;
  }

  if (node.type in tsTypes) {
    type = { name: tsTypes[node.type] };
  } else if (t.TSLiteralType.check(node)) {
    type = {
      name: 'literal',
      // @ts-ignore
      value: node.literal.raw || `${node.literal.value}`,
    };
  } else if (node.type in namedTypes) {
    type = namedTypes[node.type](path, typeParams, importer);
  } else {
    type = { name: 'unknown' };
  }

  if (isTypeAlias) {
    // mark the type as unvisited so that further calls can resolve the type again
    visitedTypes[path.parentPath.node.id.name] = type;
  }

  return type;
}

/**
 * Tries to identify the typescript type by inspecting the path for known
 * typescript type names. This method doesn't check whether the found type is actually
 * existing. It simply assumes that a match is always valid.
 *
 * If there is no match, "unknown" is returned.
 */
export default function getTSType(
  path: NodePath,
  typeParamMap: TypeParameters | null,
  importer: Importer,
): TypeDescriptor<TSFunctionSignatureType> {
  // Empty visited types before an after run
  // Before: in case the detection threw and we rerun again
  // After: cleanup memory after we are done here
  visitedTypes = {};
  const type = getTSTypeWithResolvedTypes(path, typeParamMap, importer);
  visitedTypes = {};

  return type;
}
