const files = require('fs');  //导入文件库，防止与fs变量名冲突
const types = require("@babel/types");
const parser = require("@babel/parser");
// const { expressionStatement } = require('babel-types');
const template = require("@babel/template").default;
const traverse = require("@babel/traverse").default;
const generator = require("@babel/generator").default;
const NodePath = require("@babel/traverse").NodePath; //智能提示所需

//js混淆代码读取
const encodeFile = process.argv.length > 2 ? process.argv[2] : "./encode.js";  //默认的js文件
const decodeFile = process.argv.length > 3 ? process.argv[3] : encodeFile.slice(0, encodeFile.length - 3) + "_ok.js";


//将源代码解析为AST
let sourceCode = files.readFileSync(encodeFile, { encoding: "utf-8" });
let ast = parser.parse(sourceCode);
console.time("处理完毕，耗时");



function isExpressionConstant(PathOrNode) {

	let node = PathOrNode.node || PathOrNode;

	let BrowList = ['window', 'document', 'navigator', 'location', 'history', 'screen',];

	if (types.isLiteral(node) && node.value != null) {
		return true;
	}

	if (types.isIdentifier(node) && BrowList.includes(node.name)) {
		return true;
	}

	if (types.isIdentifier(node) && typeof globalThis[node.name] != "undefined") {
		return true;
	}

	if (types.isMemberExpression(node)) {
		let { object, property } = node;

		if (types.isIdentifier(object) && typeof globalThis[object.name] != "undefined") {
			let properName = types.isIdentifier(property) ? property.name : property.value;
			if (typeof globalThis[object.name][properName] != "undefined") {
				return true;
			}
		}

		if (types.isMemberExpression(object)) {
			return isExpressionConstant(object);
		}

	}

	if (types.isUnaryExpression(node) && ["+", "-", "!", "typeof", "~"].includes(node.operator)) {
		return isExpressionConstant(node.argument);
	}

	return false;
}

const restoreVarDeclarator =
{
	VariableDeclarator(path) {
		let scope = path.scope;
		let { id, init } = path.node;

		if (!types.isIdentifier(id) || init == null || !isExpressionConstant(init)) {
			return;
		}

		const binding = scope.getBinding(id.name);

		if (!binding) return;

		let { constant, referencePaths, constantViolations } = binding;

		if (constantViolations.length > 1) {
			return;
		}

		if (constant || constantViolations[0] == path) {
			for (let referPath of referencePaths) {
				referPath.replaceWith(init);
			}
		}
	},
}

traverse(ast, restoreVarDeclarator);


const removeSingleCode =
{
	ExpressionStatement(path) {
		let { expression } = path.node;
		if (types.isIdentifier(expression) || types.isLiteral(expression)) {
			path.remove();
		}
	},
}

traverse(ast, removeSingleCode);


const restoreCallExpressoin =
{
	CallExpression(path) {
		let { parentPath, node } = path;
		if (!parentPath.isExpressionStatement({ "expression": node })) {
			return;
		}

		let { callee, arguments } = node;

		if (!types.isFunctionExpression(callee) || arguments.length != 1 || types.isCallExpression(arguments[0])) {
			return;
		}



		let body = callee.body.body;

		if (body.length != 1 || !types.isIfStatement(body[0])) {
			return;
		}

		let paramsPath = path.get('callee.params.0');

		const binding = paramsPath.scope.getBinding(paramsPath.node.name);

		if (!binding || !binding.constant) {
			return;
		}

		for (let referPath of binding.referencePaths) {
			referPath.replaceWith(arguments[0]);
		}

		path.replaceWithMultiple(body[0])
	}
}


traverse(ast, restoreCallExpressoin);


const deleteRepeatDefine = {

	"VariableDeclarator"(path) {
		let { node, scope, parentPath } = path;
		
		let oldId = node.id;
		let name = oldId.name;

		const binding = scope.getBinding(name);
		if (!binding || !binding.constant) {
			return;
		}


		scope.traverse(scope.block, {
			VariableDeclarator(path) {
				let { node, scope } = path;
				let { id, init } = node;
				if (!types.isIdentifier(init, { name: name })) {
					return;
				}

				const binding = scope.getBinding(id.name);

				if (!binding || !binding.constant)//如果被更改则不能进行替换
					return;

				for (let referPath of binding.referencePaths) {
					referPath.replaceWith(oldId);//使用replaceWith函数比rename函数更快。
				}
				path.remove();
				scope.crawl();
			},
		})
	},
}

traverse(ast, deleteRepeatDefine);




function containsSequenceExpression(path) {
	let containsSequence = false;
	// 深度优先遍历当前路径及其所有子路径
	path.traverse({
		"SequenceExpression|AssignmentExpression"(_path) {
			containsSequence = true;
			_path.stop(); // 找到逗号表达式后立即停止遍历
		},
	});
	return containsSequence;
}

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
	"EmptyStatement|DebuggerStatement"(path) {
		path.remove();
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

	"ContinueStatement|BreakStatement|ReturnStatement|ThrowStatement"(path) {
		let AllNextSiblings = path.getAllNextSiblings();  //获取所有的后续兄弟节点

		for (let nextSibling of AllNextSiblings) {

			if (nextSibling.isFunctionDeclaration() || nextSibling.isVariableDeclaration({ kind: "var" })) {//变量提升.....
				continue;
			}
			nextSibling.remove();
		}

	},

}

ast = parser.parse(generator(ast).code); //因为scope可能没有处理好，需要重新解析下处理后的ast代码;

traverse(ast, removeDeadCode);



console.timeEnd("处理完毕，耗时");
let { code } = generator(ast, opts = {
	"compact": false,  // 是否压缩代码
	"comments": false,  // 是否保留注释
	"jsescOption": { "minimal": true },  //Unicode转义
});

files.writeFile(decodeFile, code, (err) => { });