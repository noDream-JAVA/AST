const fs = require('fs');
const types = require("@babel/types");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const generator = require("@babel/generator").default;
const template = require("@babel/template").default;

//js混淆代码读取
process.argv.length > 2 ? encodeFile = process.argv[2] : encodeFile = "./encode.js";
process.argv.length > 3 ? decodeFile = process.argv[3] : decodeFile = "./decodeResult.js";

//将源代码解析为AST
let sourceCode = fs.readFileSync(encodeFile, { encoding: "utf-8" });

let ast = parser.parse(sourceCode);


console.time("处理完毕，耗时");




let tryNODE = template(`try{
	A;
}catch(e){}`);

function getEvalCode(ast) {

	let firstNode = ast.program.body[0].expression.callee.body;

	let tryNode = tryNODE({ "A": firstNode });  //使用try语句，将局部变量暴露出来。

	let evalCode = generator(tryNode).code;

	return evalCode;

}


let evalCode = getEvalCode(ast);

window = global;

eval(evalCode);



let funcNames = [];

const getFuncNames =
{
	VariableDeclarator(path) {
		let { scope, node } = path;
		let { id, init } = node;

		if (!types.isIdentifier(id) || !types.isCallExpression(init)) {
			return;
		}

		let { callee, arguments } = init;


		if (arguments.length != 1 || !types.isMemberExpression(callee) ||
			!types.isIdentifier(callee.property, { "name": "join" })) {
			return;
		}


		let name = id.name;
		let binding = scope.getBinding(name);

		if (!binding || !binding.constant || binding.references != 1) {
			return;
		}

		let referPath = binding.referencePaths[0];

		let { parentPath } = referPath;

		if (parentPath.isVariableDeclarator({ "init": referPath.node })) {
			funcNames.push(parentPath.node.id.name); //自动获取函数名。

			funcNames.push(callee.object.name);

			funcNames.push(id.name);

		}

	}
}

traverse(ast, getFuncNames);


const decodeMemberExpression =
{
	CallExpression(path) {
		let { callee, arguments } = path.node;
		if (!types.isMemberExpression(callee) || arguments.length != 2) {
			return;
		}
		let { object, property } = callee;
		if (!types.isIdentifier(object) || !types.isIdentifier(property, { "name": "substr" })) {
			return;
		}
		if (!funcNames.includes(object.name)) {
			return;
		}
		let value = eval(path.toString());
		console.log(path.toString(), "--->", value);
		path.replaceWith(types.valueToNode(value));

	}
}

traverse(ast, decodeMemberExpression);


const removeIdinfuncNames =
{
	VariableDeclarator(path) {
		let { scope, node } = path;
		let { id, init } = node;
		let name = id.name;
		if (!funcNames.includes(name)) {
			return;
		}

		let binding = scope.getBinding(name);

		if (!binding || !binding.constant) {
			return;
		}

		let { referencePaths } = binding;

		if (referencePaths.length == 0) {
			if (types.isIdentifier(init)) {
				funcNames.push(init.name);
			}
			path.remove();
			return;
		}

		if (referencePaths.length == 1) {

			let referPath = referencePaths[0];

			let whileParentPath = referPath.findParent(p => p.isLoop());

			if (whileParentPath != null) {
				if (types.isIdentifier(init)) {
					funcNames.push(init.name);
				}
				console.log(whileParentPath.toString())
				whileParentPath.remove();
				path.remove();
			}


		}
	},

}


const removeDedeadId1 =
{
	VariableDeclarator(path) {
		let { scope, node } = path;
		let { id, init } = node;

		if (!types.isMemberExpression(init)) {
			return;
		}

		let { object, property } = init;

		if (!types.isIdentifier(object) || property.name != "length") {
			return;
		}


		let binding = scope.getBinding(id.name);

		if (!binding || !binding.constant) {
			return;
		}

		let { referencePaths } = binding;

		if (referencePaths.length == 0) {
			console.log(path.toString())
			funcNames.push(object.name);
			path.remove();
			return;
		}
	},
}


const removeDedeadId2 =
{
	VariableDeclarator(path) {
		let { scope, node } = path;
		let { id, init } = node;

		if (!types.isBinaryExpression(init)) {
			return;
		}

		let binding = scope.getBinding(id.name);

		if (!binding || !binding.constant) {
			return;
		}

		let { referencePaths } = binding;

		if (referencePaths.length == 0) {
			path.remove();
			return;
		}
	},
}


for (let i = 0; i < 20; i++) {
	ast = parser.parse(generator(ast).code);
	traverse(ast, removeIdinfuncNames);
	ast = parser.parse(generator(ast).code);
	traverse(ast, removeDedeadId1);
	ast = parser.parse(generator(ast).code);
	traverse(ast, removeDedeadId2);

}


// 检查路径或其任一子路径是否包含逗号表达式
function containsSequenceExpression(path) {
	let containsSequence = false;
	// 深度优先遍历当前路径及其所有子路径
	path.traverse({
		SequenceExpression(_path) {
			containsSequence = true;
			_path.stop(); // 找到逗号表达式后立即停止遍历
		}
	});
	return containsSequence;
}

//请使用学员专版babel库
const constantFold = {
	"BinaryExpression|UnaryExpression|MemberExpression"(path) {
		if (containsSequenceExpression(path)) {
			return;
		}
		if (path.isUnaryExpression({ operator: "-" }) ||
			path.isUnaryExpression({ operator: "void" })) {
			return;
		}
		const { confident, value } = path.evaluate();

		if (!confident || typeof value == "function")
			return;

		if (typeof value == 'number' && (!Number.isFinite(value))) {
			return;
		}

		console.log(path.toString(), "--->", value);

		path.replaceWith(types.valueToNode(value));
	},
}

traverse(ast, constantFold);

const removeDeadCode = {
	"SequenceExpression"(path) {
		let { expressions } = path.node;
		let newExpressions = expressions.slice(0, -1);
		if (newExpressions.every(element => types.isLiteral(element))) {//可自己写判断函数代替isLiteral
			path.replaceWith(expressions.at(-1));
		}
	},
	"IfStatement|ConditionalExpression"(path) {
		let { consequent, alternate } = path.node;
		let testPath = path.get('test');

		if (testPath.isSequenceExpression() || testPath.isAssignmentExpression() ||
			containsSequenceExpression(testPath)) {//不处理逗号表达式，赋值语句防止误删

			return;
		}

		const evaluateTest = testPath.evaluateTruthy();
		if (evaluateTest === true) {
			if (types.isBlockStatement(consequent)) {
				consequent = consequent.body;
			}
			path.replaceWithMultiple(consequent);
			return;
		}
		if (evaluateTest === false) {
			if (alternate != null) {
				if (types.isBlockStatement(alternate)) {
					alternate = alternate.body;
				}
				path.replaceWithMultiple(alternate);
			}
			else {
				path.remove();
			}
		}
	},
	"LogicalExpression"(path) {

		let { left, operator, right } = path.node;

		let leftPath = path.get('left');

		if (leftPath.isSequenceExpression() || leftPath.isAssignmentExpression() ||
			containsSequenceExpression(leftPath)) {//不处理逗号表达式，赋值语句防止误删
			return;
		}

		const evaluateLeft = leftPath.evaluateTruthy();

		if ((operator == "||" && evaluateLeft == true) ||
			(operator == "&&" && evaluateLeft == false)) {
			path.replaceWith(left);
			return;
		}
		if ((operator == "||" && evaluateLeft == false) ||
			(operator == "&&" && evaluateLeft == true)) {
			path.replaceWith(right);
		}
	},

	"VariableDeclarator"(path) {
		let { node, scope, parentPath, parent } = path;

		let ancestryPath = parentPath.parentPath;

		if (ancestryPath.isForOfStatement({ left: parent }) ||
			ancestryPath.isForInStatement({ left: parent })) {//目前发现这两个需要过滤
			return;
		}

		let { id, init } = node;

		if (!types.isIdentifier(id) || types.isCallExpression(init) ||
			types.isAssignmentExpression(init)) {//目前只发现赋值语句和调用语句会有问题。后续待添加
			return;
		}

		let binding = scope.getBinding(id.name);//重新解析ast后，一定会有binding;
		if (!binding) return;

		let { referenced, constant, constantViolations } = binding;

		if (referenced || constantViolations.length > 1) {
			return;
		}

		if (constant || constantViolations[0] == path) {
			console.log(path.toString());
			path.remove();
		}
	},


}

ast = parser.parse(generator(ast).code); //因为scope可能没有处理好，需要重新解析下处理后的ast代码;

traverse(ast, removeDeadCode);


const simplifyMemberExpressionOfWindow =
{
	MemberExpression(path) {
		let BrowList = ['window', 'document', 'navigator', 'location', 'history', 'screen',];

		let { object, property } = path.node;

		if (!types.isIdentifier(object, { "name": "window" })) {
			return;
		}

		let key = types.isIdentifier(property) ? property.name : property.value;
		if (typeof globalThis[key] != "undefined" || BrowList.includes(key)) {
			console.log(path.toString());
			path.replaceWith(types.Identifier(key));
		}
	}
}

traverse(ast, simplifyMemberExpressionOfWindow);



//判断节点是否为字面量，插件地址 https://t.zsxq.com/09CvEE1FY
function isNodeLiteral(node) {
	if (Array.isArray(node)) {
		return node.every(ele => isNodeLiteral(ele));
	}
	if (types.isLiteral(node)) {
		if (node.value == null) {
			return false;
		}
		return true;
	}
	if (types.isBinaryExpression(node)) {
		return isNodeLiteral(node.left) && isNodeLiteral(node.right);
	}
	if (types.isUnaryExpression(node, {
		"operator": "-"
	}) || types.isUnaryExpression(node, {
		"operator": "+"
	})) {
		return isNodeLiteral(node.argument);
	}

	if (types.isObjectExpression(node)) {
		let { properties } = node;
		if (properties.length == 0) {
			return true;
		}

		return properties.every(property => isNodeLiteral(property));

	}
	if (types.isArrayExpression(node)) {
		let { elements } = node;
		if (elements.length == 0) {
			return true;
		}
		return elements.every(element => isNodeLiteral(element));
	}

	return false;
}




function isReferPath(nextSibling, referencePaths) {
	let isReferPath = false;

	for (let referPath of referencePaths) {//假装判断一下，删除也行
		if (nextSibling.isAncestor(referPath)) {
			isReferPath = true;
			break;
		}
	}

	return isReferPath;
}



function isObfuscatorInitArray(path) {//判断是否未ob混淆的特征，对于变种的ob代码，可以更改此代码

	let { parentPath, node } = path;
	let { id, body } = node;
	if (body.body.length < 2) {
		return false;
	}

	let firstNode = body.body.at(0);
	let lastNode = body.body.at(-1);
	if (!types.isVariableDeclaration(firstNode) ||
		!types.isReturnStatement(lastNode)) {
		return false;
	}
	let { init } = firstNode.declarations[0];
	if (!types.isArrayExpression(init) || init.elements.length == 0 ||
		!init.elements.every(element => types.isStringLiteral(element))) {
		return false;
	}

	let binding = parentPath.scope.getBinding(id.name);
	if (!binding) {
		return false;
	}


	let { constantViolations } = binding;

	if (constantViolations.length != 1 || !path.isAncestor(constantViolations[0])) {
		return false;
	}

	return true;
}


function callAndReplaceWith(obfuscatorCode, scope, decodePath) {

	let funcName = decodePath.node.id.name;
	let binding = scope.getBinding(funcName);

	if (!binding) return;

	require = undefined; //防止恶意格盘
	eval(obfuscatorCode);

	for (let referPath of binding.referencePaths) {


		if (decodePath.isAncestor(referPath)) {
			continue;
		}

		let { parentPath, node } = referPath;

		if (!parentPath.isCallExpression({ "callee": node })) {
			continue;
		}

		let { arguments } = parentPath.node;

		if (arguments.length == 0 || !isNodeLiteral(arguments)) {
			continue;
		}


		let value = eval(parentPath.toString());
		console.log(parentPath.toString(), "-->", value);
		parentPath.replaceWith(types.valueToNode(value));
	}
}


const CallExpressToLiteral =
{
	/**  @param  {NodePath} path */  //每个插件前都要加哈。
	FunctionDeclaration(path) {

		let { parentPath, node } = path;

		if (!isObfuscatorInitArray(path)) {
			return;//如果不是ob混淆的代码，直接退出
		}

		let obfuscatorPaths = [path];

		let scope = parentPath.scope;

		let binding = scope.getBinding(node.id.name);

		if (!binding) return;

		let { referencePaths } = binding;

		let siblingPaths = parentPath.get('body');

		let decodePath = undefined;

		for (let siblingPath of siblingPaths) {
			if (siblingPath == path) {
				continue;
			}
			if (isReferPath(siblingPath, referencePaths)) {
				obfuscatorPaths.push(siblingPath);
				if (siblingPath.isFunctionDeclaration()) {
					decodePath = siblingPath;
				}
			}

		}

		if (obfuscatorPaths.length != 3) {
			return;
		}

		let obfuscatorCode = "";
		obfuscatorPaths.forEach(eachPath => { obfuscatorCode += eachPath.toString() });


		let funcAst = parser.parse(obfuscatorCode);
		obfuscatorCode = generator(funcAst, opts = { "compact": true }).code;
		
		scope.traverse(scope.block,{
			"VariableDeclarator"(_path) {
				let { node, scope} = _path;
				let {id,init} = node;

				if (!types.isIdentifier(init,{"name":decodePath.node.id.name}))
				{
					return;
				}

				let binding = scope.getBinding(id.name);
				if (!binding || !binding.constant)
				{
					return;
				}
				console.log(_path.toString())
				for (let referPath of binding.referencePaths)
				{
					referPath.replaceWith(init);
				}
				_path.remove();
				scope.crawl();
			}
		});





		


		callAndReplaceWith(obfuscatorCode, scope, decodePath);

		obfuscatorPaths.forEach(eachPath => { eachPath.remove(); });

	},
}


traverse(ast, CallExpressToLiteral);



const removerepeatName = {
	"VariableDeclarator"(path) {
		let { node, scope, parentPath, parent } = path;

		let ancestryPath = parentPath.parentPath;

		if (ancestryPath.isForOfStatement({ left: parent }) ||
			ancestryPath.isForInStatement({ left: parent })) {//目前发现这两个需要过滤
			return;
		}

		let { id, init } = node;

		if (!types.isIdentifier(id) || !types.isIdentifier(init)) {//目前只发现赋值语句和调用语句会有问题。后续待添加
			return;
		}

		let binding = scope.getBinding(id.name);//重新解析ast后，一定会有binding;
		if (!binding) return;

		let { referenced, constant, constantViolations } = binding;

		if (referenced || constantViolations.length > 1) {
			return;
		}

		if (constant || constantViolations[0] == path) {
			console.log(path.toString());
			path.remove();
		}
	},

}

ast = parser.parse(generator(ast).code); //因为scope可能没有处理好，需要重新解析下处理后的ast代码;


traverse(ast, removerepeatName);


traverse(ast, constantFold);


ast = parser.parse(generator(ast).code); //因为scope可能没有处理好，需要重新解析下处理后的ast代码;


traverse(ast, removerepeatName);

const simplifyLiteral = {
	/**  @param  {NodePath} path */  //每个插件前都要加哈。
	NumericLiteral(path) {
		let { node } = path;
		if (node.extra && /^0[obx]/i.test(node.extra.raw)) {
			node.extra = undefined;
		}
	},
	/**  @param  {NodePath} path */
	StringLiteral(path) {
		let { node } = path;
		if (node.extra && /\\[ux]/gi.test(node.extra.raw)) {
			node.extra = undefined;
		}
	},
}


traverse(ast, simplifyLiteral);


console.timeEnd("处理完毕，耗时");


let { code } = generator(ast, opts = { jsescOption: { "minimal": true } });

fs.writeFile(decodeFile, code, (err) => { });